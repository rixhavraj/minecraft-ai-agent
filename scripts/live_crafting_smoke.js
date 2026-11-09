import { config } from '../src/config/config.js'
import { createMinecraftBot } from '../src/integrations/minecraft.js'
import { taskExecutor } from '../src/tasks/task_executor.js'
import { skillRegistry } from '../src/skills/registry.js'
import { createSkillContext } from '../src/skills/context.js'
import '../src/skills/index.js'

if (process.env.LIVE_TESTS !== '1') throw new Error('Live tests require LIVE_TESTS=1')
const configured = config.minecraft.bots?.[0] ?? config.minecraft
const username = process.env.LIVE_TEST_USERNAME ?? `Craft_${Date.now().toString(36).slice(-6)}`
if (username === 'newbee') throw new Error('Live tests refuse the production username newbee')
const bot = createMinecraftBot({ ...configured, username }, () => {})

await new Promise((resolve, reject) => {
  const onError = (error) => { cleanup(); reject(error) }
  const onSpawn = () => { cleanup(); resolve() }
  const onEnd = () => { cleanup(); reject(new Error('Minecraft disconnected before spawn')) }
  const cleanup = () => { bot.removeListener('error', onError); bot.removeListener('spawn', onSpawn); bot.removeListener('end', onEnd) }
  bot.once('error', onError)
  bot.once('spawn', onSpawn)
  bot.once('end', onEnd)
})

taskExecutor.setBot(bot)
const context = createSkillContext(bot, 'live_crafting_smoke')
const inventory = await skillRegistry.get('inspect_inventory').execute(bot, {}, context)
console.log(JSON.stringify({ phase: 'inventory_before', aggregated: inventory.aggregated }, null, 2))

const craft = await skillRegistry.get('craft_stone_tools').execute(bot, { tool: 'stone_pickaxe' }, context)
console.log(JSON.stringify({ phase: 'craft_stone_pickaxe', result: craft, heldItem: bot.heldItem?.name ?? null }, null, 2))
if (!craft.success || bot.heldItem?.name !== 'stone_pickaxe') process.exitCode = 1

const mine = await skillRegistry.get('collect_ore').execute(bot, { ore: 'iron', quantity: 1 }, context)
console.log(JSON.stringify({ phase: 'mine_iron', result: mine, heldItem: bot.heldItem?.name ?? null }, null, 2))
if (!mine.success || mine.collected < 1) process.exitCode = 1

const inventoryAfter = await skillRegistry.get('inspect_inventory').execute(bot, {}, context)
console.log(JSON.stringify({ phase: 'inventory_after', aggregated: inventoryAfter.aggregated }, null, 2))
taskExecutor.emergencyStop()
try { bot.quit('Crafting smoke test finished') } catch { /* already disconnected */ }
