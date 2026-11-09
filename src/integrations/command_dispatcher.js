/**
 * Command Dispatcher for Telegram and Natural-Language Control
 *
 * Routes Telegram slash commands and natural-language instructions
 * to the AutonomousTaskExecutor, AgentRegistry, and SkillRegistry.
 */

import { taskExecutor } from '../tasks/task_executor.js'
import { agentRegistry } from '../agents/agent_registry.js'
import { skillRegistry } from '../skills/registry.js'
import { skillExecutor } from '../skills/executor.js'
import { memoryStore } from '../database/memory_store.js'
import { savedBaseCoordinates } from '../skills/world_management.js'
import { logger } from '../utils/logger.js'
import { goalManager } from '../tasks/goal_manager.js'
import { BenchmarkRunner } from '../evaluation/benchmark.js'

const log = logger.child({ component: 'CommandDispatcher' })

export async function dispatchCommand(inputMessage, { bot, telegram, username = 'Owner', npcController = null } = {}) {
  const text = inputMessage.trim()
  const [cmd, ...rest] = text.split(/\s+/)
  const lowerCmd = cmd.toLowerCase()
  const args = rest.join(' ')

  log.info({ command: lowerCmd, args }, 'Processing command input')

  // Deterministic read-only questions must never wait behind a movement or
  // gathering task. Read the live Mineflayer state directly.
  if (bot && /\b(inventory|what(?:'s| is)\s+(?:in|on)\s+your inventory)\b/i.test(text)) {
    const items = bot.inventory?.items?.() ?? []
    const summary = items.length ? items.map((item) => `${item.name} x${item.count}`).join(', ') : 'empty'
    return `Verified inventory: ${summary}. Total items: ${items.reduce((sum, item) => sum + item.count, 0)}. Empty slots: ${36 - items.length}.`
  }
  if (bot && /\b(?:how much health|health|hunger|food level)\b/i.test(text) && !/find food|eat|gather/i.test(text)) {
    return `Verified vitals: health ${bot.health ?? 'unknown'}/20, hunger ${bot.food ?? 'unknown'}/20.`
  }

  const professionMatch = text.match(/^(?:become|change[ \t]+(?:your[ \t]+)?profession[ \t]+to|work[ \t]+as)[ \t]+(?:a[ \t]+)?(farmer|miner|builder|explorer|lumberjack|fisherman|blacksmith|trader|guard|researcher)\b/i)
  if (professionMatch && npcController) {
    const profession = npcController.setProfession(professionMatch[1])
    return `Understood. I am now assigned as a ${profession}. I will use the shared task executor for that profession's routine.`
  }

  // ── 1. Slash Commands ───────────────────────────────────────────────────────

  if (lowerCmd === '/help') {
    return [
      '🤖 Minecraft AI Squad Commands:',
      '/start - Start the command center',
      '/status - Connection & task executor status',
      '/agents - List all 10 specialized agents',
      '/skills - List registered gameplay skills',
      '/task - Active task progress & queue',
      '/position - Current bot XYZ coordinates',
      '/survival or /health - Health, hunger & hostiles',
      '/hunger - Current hunger and food inventory',
      '/inventory - Inventory items & resources',
      '/base - Show or save base coordinates',
      '/follow [player] - Follow player',
      '/stop - Stop movement & halt active task',
      '/explore [radius] - Scout surrounding terrain',
      '/mine <resource> [qty] - Mine ores or wood',
      '/farm [crop] - Harvest & plant crops',
      '/build <structure> - Build house/wall/shelter',
      '/craft <item> - Craft tools & equipment',
      '/pause - Pause task execution',
      '/resume - Resume task execution',
      '/cancel - Cancel current task',
      '/memory - Recent verified memories',
      '/learning - Recent lessons and failures',
      '/history - Recent task history',
      '/actions - Recent persisted skill action lifecycle',
      '/decisions - Recent task decisions and execution events',
      '/benchmark <objective> - Execute and record a measured benchmark task',
      '/goal - View or create long-term goals',
      '',
      '💬 Or send any natural language instruction:',
      '• "Collect 32 oak logs and build a small house"',
      '• "Find food and cook it"',
      '• "Mine iron and craft tools"',
      '• "Build a safe base and protect the area"',
    ].join('\n')
  }

  if (lowerCmd === '/start') {
    return 'Minecraft AI Squad command center ready. Use /status for the actual bot state or send a natural-language objective.'
  }

  if (lowerCmd === '/status') {
    const execStatus = taskExecutor.getStatus()
    const botStatus = bot?.entity ? 'Connected' : 'Connecting/Offline'
    const pos = bot?.entity?.position
    const posStr = pos ? `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})` : 'unknown'
    const activeInfo = execStatus.activeTask
      ? `\nActive Task: #${execStatus.activeTask.id.slice(0, 8)} [${execStatus.activeTask.status}] "${execStatus.activeTask.instruction}" (Step ${execStatus.activeTask.step})`
      : '\nActive Task: None (idle)'

    return [
      `🤖 Squad Status:`,
      `Bot: ${botStatus} at ${posStr}`,
      `Health: ${bot?.health ?? 'unknown'}/20 | Hunger: ${bot?.food ?? 'unknown'}/20`,
      `Execution Lock: ${execStatus.isPaused ? 'PAUSED' : (execStatus.isEmergencyStopped ? 'EMERGENCY STOP' : 'ACTIVE')}`,
      `Queued Tasks: ${execStatus.queuedCount}`,
      activeInfo,
    ].join('\n')
  }

  if (lowerCmd === '/agents') {
    const list = agentRegistry.listAgents()
    return [
      `👥 The 10 Squad Agents:`,
      ...list.map(a => `• ${a.name} (${a.role}): [${a.status}]`),
    ].join('\n')
  }

  if (lowerCmd === '/skills') {
    const skills = skillRegistry.list()
    const categories = {}
    for (const s of skills) {
      categories[s.category] = categories[s.category] || []
      categories[s.category].push(s.id)
    }

    const lines = [`⚡ Registered Gameplay Skills (${skills.length} total):`]
    for (const [cat, items] of Object.entries(categories)) {
      lines.push(`\n[${cat.toUpperCase()}] (${items.length}):`)
      lines.push(items.join(', '))
    }
    return lines.join('\n')
  }

  if (lowerCmd === '/task') {
    const status = taskExecutor.getStatus()
    const recent = memoryStore.getRecentTasks(5)
    const lines = [
      `📋 Task Engine:`,
      `Active: ${status.activeTask ? `"${status.activeTask.instruction}" [${status.activeTask.status}]` : 'None'}`,
      `Queue Depth: ${status.queuedCount}`,
      `\nRecent Tasks:`,
      ...recent.map(t => `• #${t.id.slice(0, 8)}: "${t.instruction.slice(0, 30)}" [${t.status}]`),
    ]
    return lines.join('\n')
  }

  if (lowerCmd === '/position' || lowerCmd === '/where' || text.match(/^(where|location|coordinates?|coords?|pos|position)\b/i)) {
    const p = bot?.entity?.position
    if (!p) return 'Bot is not yet spawned in world.'
    return `📍 Current Position: X: ${p.x.toFixed(1)}, Y: ${p.y.toFixed(1)}, Z: ${p.z.toFixed(1)}`
  }

  if (lowerCmd === '/survival' || lowerCmd === '/health') {
    const h = bot?.health ?? 'unknown'
    const f = bot?.food ?? 'unknown'
    const hostiles = []
    if (bot?.entities) {
      for (const ent of Object.values(bot.entities)) {
        if (ent.type === 'mob' && ent.position && bot.entity?.position) {
          const dist = bot.entity.position.distanceTo(ent.position)
          if (dist <= 16) hostiles.push(`${ent.name} (${dist.toFixed(1)}m)`)
        }
      }
    }
    return [
      `❤️ Survival Vitals:`,
      `Health: ${h}/20`,
      `Hunger: ${f}/20`,
      `Hostiles (within 16m): ${hostiles.length > 0 ? hostiles.join(', ') : 'None detected'}`,
    ].join('\n')
  }

  if (lowerCmd === '/hunger') {
    if (!bot) return 'Minecraft bot is not connected.'
    const foods = bot.inventory?.items?.().filter((item) => /bread|cooked_|carrot|potato|apple|berries|beetroot|melon/.test(item.name)) ?? []
    const summary = foods.length ? foods.map((item) => `${item.name} x${item.count}`).join(', ') : 'none'
    return `🍖 Hunger: ${bot.food ?? 'unknown'}/20 | Saturation: ${bot.foodSaturation ?? 'unknown'}\nFood: ${summary}`
  }

  if (lowerCmd === '/inventory' || lowerCmd === '/inv') {
    if (!bot?.inventory) return 'Bot inventory not loaded.'
    const items = bot.inventory.items()
    if (items.length === 0) return 'Inventory is empty.'
    const formatted = items.map(i => `${i.name} x${i.count}`).join(', ')
    return `🎒 Inventory (${items.length} slots occupied):\n${formatted}`
  }

  if (lowerCmd === '/base') {
    if (args.startsWith('set')) {
      const p = bot?.entity?.position
      if (!p) return 'Cannot set base: bot not spawned.'
      const result = await skillExecutor.execute(bot, 'save_base', { name: 'main_base' })
      if (!result.success) return `Cannot save base: ${result.error}`
      return `🏠 Base coordinates saved at X: ${Math.round(p.x)}, Y: ${Math.round(p.y)}, Z: ${Math.round(p.z)}`
    }
    if (!savedBaseCoordinates) {
      return 'No base coordinates saved yet. Use /base set while standing at base.'
    }
    return `🏠 Saved Base: "${savedBaseCoordinates.name}" at X: ${savedBaseCoordinates.x}, Y: ${savedBaseCoordinates.y}, Z: ${savedBaseCoordinates.z}`
  }

  if (lowerCmd === '/follow' || lowerCmd === 'follow' || text.match(/^(follow|come\b)/i)) {
    const targetPlayer = (args && args !== 'me' && args !== 'here')
      ? args
      : (username && username !== 'Owner' ? username : (process.env.MINECRAFT_PLAYER_NAME || 'me'))

    // Route this through the authoritative planner so reaching a called
    // player can prepare transport (wood -> planks -> boat) before following.
    await taskExecutor.submitCommand(`follow ${targetPlayer} using the safest route`, 5, username)
    return `On it: I’ll prepare the needed transport and follow ${targetPlayer}.`
  }

  if (lowerCmd === '/stop' || lowerCmd === 'stop' || lowerCmd === 'halt' || lowerCmd === 'wait') {
    if (bot?.pathfinder) bot.pathfinder.setGoal(null)
    if (bot?.clearControlStates) bot.clearControlStates()
    taskExecutor.emergencyStop()
    taskExecutor.resetEmergencyStop()
    return '🛑 Stopped all movement and tasks.'
  }

  if (lowerCmd === '/pause') {
    taskExecutor.pause()
    return '⏸️ Task execution paused.'
  }

  if (lowerCmd === '/resume') {
    taskExecutor.resume()
    return '▶️ Task execution resumed.'
  }

  if (lowerCmd === '/cancel') {
    taskExecutor.cancelCurrent()
    return '⏹️ Active task cancelled.'
  }

  if (lowerCmd === '/memory' || lowerCmd === '/learning') {
    const memories = memoryStore.retrieveExperiences({ verifiedOnly: lowerCmd === '/memory', limit: 8 })
    if (!memories.length) return 'No stored memories yet.'
    return `${lowerCmd === '/memory' ? '🧠 Verified memories' : '📚 Recent learning'}:\n${memories.map((memory) => `• [${memory.kind}] ${memory.content.slice(0, 120)}`).join('\n')}`
  }

  if (lowerCmd === '/history') {
    const tasks = memoryStore.getRecentTasks(8)
    if (!tasks.length) return 'No task history yet.'
    return `📜 Task history:\n${tasks.map((task) => `• #${task.id.slice(0, 8)} [${task.status}] ${task.instruction.slice(0, 90)}`).join('\n')}`
  }

  if (lowerCmd === '/actions') {
    const actions = memoryStore.getRecentActions(8)
    if (!actions.length) return 'No skill actions recorded yet.'
    return `⚙️ Recent actions:\n${actions.map(action => `• ${action.skill_id} [${action.status}] ${action.error ? action.error.slice(0, 80) : ''}`).join('\n')}`
  }

  if (lowerCmd === '/decisions') {
    const task = memoryStore.getRecentTasks(1)[0]
    if (!task) return 'No task decisions recorded yet.'
    const events = memoryStore.getTaskEvents(task.id, 20)
    return `🧭 Latest task: ${task.instruction}\n${events.map(event => `• ${event.event}`).join('\n') || 'No events recorded.'}`
  }

  if (lowerCmd === '/benchmark') {
    if (!args) return 'Usage: /benchmark <objective>'
    const result = await new BenchmarkRunner().run({ label: `Telegram: ${args}`, instruction: args, mode: 'live' })
    return `📏 Benchmark ${result.status}: ${args}\nSuccess: ${result.success}\nDuration: ${result.durationMs}ms\nTask: ${result.taskId ?? 'not created'}`
  }

  if (lowerCmd === '/goal') {
    if (!args) {
      const goals = goalManager.active()
      return goals.length ? `🎯 Active goals:\n${goals.map((goal) => `• [${Math.round(goal.progress * 100)}%] ${goal.title}`).join('\n')}` : 'No active goals.'
    }
    const id = goalManager.create({ title: args, description: args, priority: 1 })
    return `🎯 Goal created: #${id.slice(0, 8)} ${args}`
  }

  if (lowerCmd === '/explore') {
    const rad = parseInt(args, 10) || 64
    await taskExecutor.submitCommand(`explore area radius ${rad}`, 5)
    return `Explorer agent dispatched to scout ${rad} blocks.`
  }

  if (lowerCmd === '/mine') {
    const order = args || 'iron'
    await taskExecutor.submitCommand(`mine ${order}`, 5)
    return `Miner agent assigned to mine ${order}.`
  }

  if (lowerCmd === '/farm') {
    const order = args || 'wheat'
    await taskExecutor.submitCommand(`harvest and plant ${order}`, 5)
    return `Survival agent assigned to farm ${order}.`
  }

  if (lowerCmd === '/build') {
    const order = args || 'small house'
    await taskExecutor.submitCommand(`build ${order}`, 5)
    return `Builder agent assigned to build ${order}.`
  }

  if (lowerCmd === '/craft') {
    if (!args) return 'Usage: /craft <item_name>'
    await taskExecutor.submitCommand(`craft ${args}`, 5)
    return `Crafter agent assigned to craft ${args}.`
  }

  // ── 2. Natural Language Instruction ─────────────────────────────────────────

  // Strip leading slash if any unknown command was used
  const naturalText = text.startsWith('/') ? text.slice(1) : text

  // Submit to autonomous task executor for full planning and execution
  const task = await taskExecutor.submitCommand(naturalText, 1, username)
  if (bot) {
    return `On it: ${naturalText}`
  }
  return `🫡 Commander received objective: "${naturalText}".\nAssigned Task #${task.id.slice(0, 8)}. Strategist is planning execution steps...`
}

