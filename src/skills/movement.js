/**
 * Movement skill module for minecraft-ai-squad
 *
 * Registers all movement-related skills: pathfinding, following,
 * hazard avoidance, stuck detection/recovery, swimming, climbing.
 */

import { skillRegistry } from './registry.js'
import minecraftData from 'minecraft-data'
import pathfinderPackage from 'mineflayer-pathfinder'

const { Movements: DefaultMovements, goals: { GoalFollow: DefaultGoalFollow } } = pathfinderPackage

// ─── follow_player ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'follow_player',
  name: 'Follow Player',
  category: 'movement',
  description: 'Follow a player using pathfinder with dynamic goal tracking',
  arguments: {
    player: { type: 'string', required: true, description: 'Username of the player to follow' },
    distance: { type: 'number', required: false, default: 2, description: 'Distance to maintain from the player' },
  },
  requires: [],
  permissions: [],
  timeout: 60000,

  async execute(bot, args, context = {}) {
    const GoalFollow = context.GoalFollow ?? DefaultGoalFollow
    const Movements = context.Movements ?? DefaultMovements
    const logger = context.logger ?? console

    let targetEntity = null
    const searchName = (args.player || '').toLowerCase().trim()

    if (!searchName || searchName === 'me' || searchName === 'player') {
      // Find nearest player entity that is not the bot
      const players = Object.values(bot.entities || {}).filter(e => e.type === 'player' && e.username !== bot.username)
      if (players.length > 0) {
        players.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))
        targetEntity = players[0]
      }
    }

    if (!targetEntity && searchName) {
      // Case-insensitive lookup in bot.players
      for (const [pName, pObj] of Object.entries(bot.players || {})) {
        if (pName.toLowerCase() === searchName) {
          targetEntity = pObj.entity
          break
        }
      }
      if (!targetEntity) {
        targetEntity = Object.values(bot.entities || {}).find(e => e.type === 'player' && e.username?.toLowerCase() === searchName)
      }
    }

    if (!targetEntity) {
      return { success: false, error: `Cannot see player '${args.player || 'nearby'}'. Make sure you are within view.` }
    }

    const distance = args.distance ?? 2
    const data = context?.mcData || minecraftData(bot.version)
    if (Movements && data) {
      const movements = new Movements(bot, data)
      movements.canDig = false
      movements.allow1by1towers = false
      movements.allowParkour = true
      movements.allowSprinting = true
      bot.pathfinder.setMovements(movements)
    }

    const goal = new GoalFollow(targetEntity, distance)
    bot.pathfinder.setGoal(goal, true) // dynamic = true for continuous following

    const targetName = targetEntity.username || args.player || 'you'
    logger.info({ player: targetName, distance }, 'Now following player')
    return {
      success: true,
      message: `Following ${targetName} at distance ${distance}`,
      dynamic: true,
    }
  },

  async verify(bot) {
    return bot.pathfinder?.goal !== null
  },
})

// ─── stop_movement ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'stop_movement',
  name: 'Stop Movement',
  category: 'movement',
  description: 'Cancel all pathfinder goals and stop the bot from moving',
  arguments: {},
  requires: [],
  permissions: [],
  timeout: 5000,

  async execute(bot, args, context) {
    const { logger } = context
    bot.pathfinder.setGoal(null)
    bot.clearControlStates()
    logger.info('All movement stopped')
    return { success: true, message: 'Movement stopped' }
  },
})

// ─── goto_position ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'goto_position',
  name: 'Go To Position',
  category: 'movement',
  description: 'Navigate to specific XYZ coordinates using pathfinder',
  arguments: {
    x: { type: 'number', required: true, description: 'Target X coordinate' },
    y: { type: 'number', required: true, description: 'Target Y coordinate' },
    z: { type: 'number', required: true, description: 'Target Z coordinate' },
  },
  requires: [],
  permissions: [],
  timeout: 120000,

  async execute(bot, args, context) {
    const { GoalBlock, Movements } = context
    const { logger } = context
    const { x, y, z } = args

    if (![x, y, z].every(Number.isFinite)) {
      const error = new Error('Destination coordinates must be finite numbers')
      error.code = 'NAVIGATION_ERROR'
      throw error
    }
    if (!bot.entity?.position || !bot.pathfinder) {
      const error = new Error('Navigation unavailable: bot position or pathfinder is missing')
      error.code = 'NAVIGATION_ERROR'
      throw error
    }

    const distanceToTarget = () => bot.entity.position.distanceTo({ x, y, z })
    if (distanceToTarget() <= 3) return { success: true, status: 'REACHED', verified: true, finalPosition: { ...bot.entity.position }, distanceFromTarget: distanceToTarget() }

    const movements = new Movements(bot, context?.mcData || minecraftData(bot.version))
    bot.pathfinder.setMovements(movements)
    const attempt = async (goal, attemptNumber) => new Promise((resolve, reject) => {
      let settled = false; let lastDistance = distanceToTarget(); let lastProgressAt = Date.now()
      const finish = (outcome, error = null) => { if (settled) return; settled = true; clearTimeout(timer); clearInterval(progressTimer); bot.removeListener('goal_reached', onArrived); bot.removeListener('path_stop', onPathStopped); bot.removeListener('path_update', onPathUpdate); bot.removeListener('end', onEnd); context.signal?.removeEventListener('abort', onAbort); bot.pathfinder.setGoal(null); error ? reject(Object.assign(new Error(error.message), { code: error.code })) : resolve(outcome) }
      const onArrived = () => { const distance=distanceToTarget(); if(distance<=3) finish({status:'REACHED',distance}); else finish(null,Object.assign(new Error(`Goal reached but destination is ${distance.toFixed(1)} blocks away`),{code:'NAVIGATION_VERIFICATION'})) }
      const onPathStopped = () => { if(distanceToTarget()>3) finish(null,Object.assign(new Error('Pathfinder stopped before reaching destination'),{code:'NAVIGATION_STUCK'})) }
      const onPathUpdate = (result) => { if(result?.status==='noPath') finish(null,Object.assign(new Error(`No path found: ${result.reason??'unknown'}`),{code:'NAVIGATION_UNREACHABLE'})) }
      const onEnd = () => finish(null,Object.assign(new Error('Minecraft bot disconnected during navigation'),{code:'NAVIGATION_ERROR'}))
      const onAbort = () => finish(null,Object.assign(new Error('Navigation cancelled'),{code:'NAVIGATION_CANCELLED'}))
      const timer=setTimeout(()=>finish(null,Object.assign(new Error(`Navigation timed out at ${distanceToTarget().toFixed(1)} blocks from destination`),{code:'NAVIGATION_TIMEOUT'})),45_000)
      const progressTimer=setInterval(()=>{const distance=distanceToTarget(); if(distance<lastDistance-0.5){lastDistance=distance;lastProgressAt=Date.now();logger.info({x,y,z,distance,attempt:attemptNumber},'Navigation progress')} else if(Date.now()-lastProgressAt>12_000){finish(null,Object.assign(new Error(`Navigation stuck with no progress; distance ${distance.toFixed(1)}`),{code:'NAVIGATION_STUCK'}))}},1000)
      bot.on('goal_reached',onArrived); bot.on('path_stop',onPathStopped); bot.on('path_update',onPathUpdate); bot.once('end',onEnd); context.signal?.addEventListener('abort',onAbort,{once:true}); bot.pathfinder.setGoal(goal)
      logger.info({x,y,z,attempt:attemptNumber,distance:lastDistance},'Navigation attempt started')
    })
    try { return { success:true, ...(await attempt(new GoalBlock(x,y,z),1)), verified:true, message:`Arrived near (${x}, ${y}, ${z})`, finalPosition:{...bot.entity.position}, distanceFromTarget:distanceToTarget() } }
    catch (firstError) {
      if (['NAVIGATION_CANCELLED','NAVIGATION_ERROR'].includes(firstError.code)) throw firstError
      logger.warn({x,y,z,firstFailure:firstError.code},'Navigation first route failed; trying GoalNear alternative')
      try { return { success:true, ...(await attempt(new context.GoalNear(x,y,z,2),2)), verified:true, message:`Arrived near (${x}, ${y}, ${z})`, finalPosition:{...bot.entity.position}, distanceFromTarget:distanceToTarget() } }
      catch (secondError) { logger.error({x,y,z,firstFailure:firstError.code,secondFailure:secondError.code,distance:distanceToTarget()},'Navigation failed after bounded alternatives'); throw secondError }
    }
  },

  async verify(bot, args) {
    const dist = bot.entity.position.distanceTo({ x: args.x, y: args.y, z: args.z })
    return { valid: dist < 3, distance: dist }
  },
})

// ─── goto_player ─────────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'goto_player',
  name: 'Go To Player',
  category: 'movement',
  description: 'Navigate near a player using GoalNear',
  arguments: {
    player: { type: 'string', required: true, description: 'Username of the player to go to' },
    distance: { type: 'number', required: false, default: 3, description: 'How close to get to the player' },
  },
  requires: [],
  permissions: [],
  timeout: 120000,

  async execute(bot, args, context) {
    const { GoalNear, Movements } = context
    const { logger } = context

    const targetPlayer = bot.players[args.player]
    if (!targetPlayer) {
      return { success: false, error: `Player '${args.player}' is not online` }
    }
    if (!targetPlayer.entity) {
      return { success: false, error: `Player '${args.player}' is not visible` }
    }

    const distance = args.distance ?? 3
    const targetPos = targetPlayer.entity.position

    const movements = new Movements(bot, context?.mcData || minecraftData(bot.version))
    bot.pathfinder.setMovements(movements)

    const goal = new GoalNear(targetPos.x, targetPos.y, targetPos.z, distance)
    bot.pathfinder.setGoal(goal)

    logger.info({ player: args.player, distance }, 'Navigating to player')

    await new Promise((resolve, reject) => {
      const onArrived = () => { cleanup(); resolve() }
      const onStopped = () => { cleanup(); resolve() }
      const onNoPath = () => { cleanup(); reject(new Error('No path to player')) }
      const cleanup = () => {
        bot.removeListener('goal_reached', onArrived)
        bot.removeListener('path_stop', onStopped)
        bot.removeListener('path_update', onNoPath)
      }
      bot.on('goal_reached', onArrived)
      bot.on('path_stop', onStopped)
      bot.on('path_update', (r) => { if (r.status === 'noPath') onNoPath() })
    })

    const finalDist = bot.entity.position.distanceTo(targetPos)
    logger.info({ player: args.player, distance: finalDist }, 'Arrived near player')
    return {
      success: true,
      message: `Arrived near player '${args.player}'`,
      distance: finalDist,
    }
  },

  async verify(bot, args) {
    const target = bot.players[args.player]?.entity
    if (!target) return { valid: false, reason: 'Player not visible' }
    const dist = bot.entity.position.distanceTo(target.position)
    return { valid: dist <= (args.distance ?? 3) + 2, distance: dist }
  },
})

// ─── explore_area ────────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'explore_area',
  name: 'Explore Area',
  category: 'movement',
  description: 'Explore the surroundings by walking to random positions within a radius, tracking visited chunks',
  arguments: {
    radius: { type: 'number', required: false, default: 64, description: 'Exploration radius in blocks' },
    duration: { type: 'number', required: false, default: 30000, description: 'How long to explore in milliseconds' },
  },
  requires: [],
  permissions: [],
  timeout: 120000,

  async execute(bot, args, context) {
    const { GoalXZ, Movements } = context
    const { logger, wait } = context

    const radius = args.radius ?? 64
    const duration = args.duration ?? 30000
    const startTime = Date.now()
    const origin = bot.entity.position.clone()
    const visitedChunks = new Set()
    let explorationSteps = 0

    const movements = new Movements(bot, context?.mcData || minecraftData(bot.version))
    movements.canDig = false
    bot.pathfinder.setMovements(movements)

    // Record starting chunk
    const chunkKey = (pos) => `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`
    visitedChunks.add(chunkKey(origin))

    logger.info({ radius, duration }, 'Starting area exploration')

    while (Date.now() - startTime < duration) {
      // Pick a random direction within the radius
      const angle = Math.random() * 2 * Math.PI
      const dist = Math.random() * radius
      const targetX = Math.floor(origin.x + Math.cos(angle) * dist)
      const targetZ = Math.floor(origin.z + Math.sin(angle) * dist)

      const goal = new GoalXZ(targetX, targetZ)
      bot.pathfinder.setGoal(goal)

      // Wait for goal_reached, path_stop, or a timeout per step
      const stepTimeout = Math.min(10000, duration - (Date.now() - startTime))
      if (stepTimeout <= 0) break

      await new Promise((resolve) => {
        const timer = setTimeout(() => { cleanup(); resolve() }, stepTimeout)
        const onDone = () => { cleanup(); resolve() }
        const cleanup = () => {
          clearTimeout(timer)
          bot.removeListener('goal_reached', onDone)
          bot.removeListener('path_stop', onDone)
        }
        bot.on('goal_reached', onDone)
        bot.on('path_stop', onDone)
      })

      visitedChunks.add(chunkKey(bot.entity.position))
      explorationSteps++

      // Brief pause between exploration steps
      if (Date.now() - startTime < duration) {
        await wait(500)
      }
    }

    bot.pathfinder.setGoal(null)

    const finalPos = bot.entity.position
    logger.info({
      chunksVisited: visitedChunks.size,
      steps: explorationSteps,
      elapsed: Date.now() - startTime,
    }, 'Exploration complete')

    return {
      success: true,
      message: `Explored ${visitedChunks.size} chunks in ${explorationSteps} steps`,
      chunksVisited: visitedChunks.size,
      steps: explorationSteps,
      visitedChunks: [...visitedChunks],
      finalPosition: { x: finalPos.x, y: finalPos.y, z: finalPos.z },
    }
  },
})

// ─── return_to_base ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'return_to_base',
  name: 'Return to Base',
  category: 'movement',
  description: 'Navigate back to the saved base coordinates',
  arguments: {
    x: { type: 'number', required: true, description: 'Base X coordinate' },
    y: { type: 'number', required: true, description: 'Base Y coordinate' },
    z: { type: 'number', required: true, description: 'Base Z coordinate' },
  },
  requires: [],
  permissions: [],
  timeout: 180000,

  async execute(bot, args, context) {
    const { GoalBlock, Movements } = context
    const { logger } = context
    const { x, y, z } = args

    const movements = new Movements(bot, context?.mcData || minecraftData(bot.version))
    bot.pathfinder.setMovements(movements)

    const goal = new GoalBlock(x, y, z)
    bot.pathfinder.setGoal(goal)

    logger.info({ x, y, z }, 'Returning to base')

    await new Promise((resolve, reject) => {
      const onArrived = () => { cleanup(); resolve() }
      const onStopped = () => { cleanup(); resolve() }
      const onNoPath = () => { cleanup(); reject(new Error('No path to base')) }
      const cleanup = () => {
        bot.removeListener('goal_reached', onArrived)
        bot.removeListener('path_stop', onStopped)
        bot.removeListener('path_update', onNoPath)
      }
      bot.on('goal_reached', onArrived)
      bot.on('path_stop', onStopped)
      bot.on('path_update', (r) => { if (r.status === 'noPath') onNoPath() })
    })

    const dist = bot.entity.position.distanceTo({ x, y, z })
    logger.info({ distance: dist }, 'Arrived at base')
    return {
      success: true,
      message: `Returned to base at (${x}, ${y}, ${z})`,
      distanceFromBase: dist,
    }
  },

  async verify(bot, args) {
    const dist = bot.entity.position.distanceTo({ x: args.x, y: args.y, z: args.z })
    return { valid: dist < 5, distance: dist }
  },
})

// ─── navigate_forest ─────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'navigate_forest',
  name: 'Navigate Forest',
  category: 'movement',
  description: 'Navigate through forest terrain with sprinting and tree avoidance',
  arguments: {
    x: { type: 'number', required: true, description: 'Target X coordinate' },
    y: { type: 'number', required: true, description: 'Target Y coordinate' },
    z: { type: 'number', required: true, description: 'Target Z coordinate' },
  },
  requires: [],
  permissions: [],
  timeout: 120000,

  async execute(bot, args, context) {
    const { GoalBlock, Movements } = context
    const { logger, mcData } = context
    const { x, y, z } = args

    const movements = new Movements(bot, context?.mcData || minecraftData(bot.version))
    movements.allowSprinting = true
    movements.canDig = true
    // Allow breaking leaves for easier forest navigation
    const leavesTypes = ['oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves', 'azalea_leaves', 'flowering_azalea_leaves']
    for (const leafName of leavesTypes) {
      const leafBlock = mcData.blocksByName[leafName]
      if (leafBlock) {
        movements.blocksCanBreak.add(leafBlock.id)
      }
    }
    bot.pathfinder.setMovements(movements)

    const goal = new GoalBlock(x, y, z)
    bot.pathfinder.setGoal(goal)

    logger.info({ x, y, z }, 'Navigating through forest')

    await new Promise((resolve, reject) => {
      const onArrived = () => { cleanup(); resolve() }
      const onStopped = () => { cleanup(); resolve() }
      const onNoPath = () => { cleanup(); reject(new Error('No path through forest')) }
      const cleanup = () => {
        bot.removeListener('goal_reached', onArrived)
        bot.removeListener('path_stop', onStopped)
        bot.removeListener('path_update', onNoPath)
      }
      bot.on('goal_reached', onArrived)
      bot.on('path_stop', onStopped)
      bot.on('path_update', (r) => { if (r.status === 'noPath') onNoPath() })
    })

    const dist = bot.entity.position.distanceTo({ x, y, z })
    logger.info({ distance: dist }, 'Forest navigation complete')
    return {
      success: true,
      message: `Navigated through forest to (${x}, ${y}, ${z})`,
      distanceFromTarget: dist,
    }
  },
})

// ─── navigate_cave ───────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'navigate_cave',
  name: 'Navigate Cave',
  category: 'movement',
  description: 'Navigate underground caves, optionally placing torches for light',
  arguments: {
    x: { type: 'number', required: true, description: 'Target X coordinate' },
    y: { type: 'number', required: true, description: 'Target Y coordinate' },
    z: { type: 'number', required: true, description: 'Target Z coordinate' },
    placeTorches: { type: 'boolean', required: false, default: true, description: 'Whether to place torches along the way' },
  },
  requires: [],
  permissions: [],
  timeout: 180000,

  async execute(bot, args, context) {
    const { GoalBlock, Movements } = context
    const { logger, mcData, wait, hasItem } = context
    const { x, y, z, placeTorches = true } = args

    const movements = new Movements(bot, context?.mcData || minecraftData(bot.version))
    movements.allowSprinting = false // Careful movement in caves
    movements.canDig = true
    // Don't break valuable ores by accident
    const protectedBlocks = ['diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore', 'ancient_debris']
    for (const blockName of protectedBlocks) {
      const block = mcData.blocksByName[blockName]
      if (block) movements.blocksCantBreak.add(block.id)
    }
    bot.pathfinder.setMovements(movements)

    const goal = new GoalBlock(x, y, z)
    bot.pathfinder.setGoal(goal)

    logger.info({ x, y, z, placeTorches }, 'Navigating cave')

    let torchesPlaced = 0
    let lastTorchPos = bot.entity.position.clone()

    // Torch placement loop — runs in parallel with pathfinding
    const torchInterval = placeTorches ? setInterval(async () => {
      try {
        if (!hasItem('torch', 1)) return

        const currentPos = bot.entity.position
        const distFromLastTorch = currentPos.distanceTo(lastTorchPos)

        // Place a torch every ~8 blocks
        if (distFromLastTorch < 8) return

        // Check light level at current position
        const currentBlock = bot.blockAt(currentPos)
        if (currentBlock && currentBlock.light < 7) {
          // Find a solid block below or beside us to place a torch on
          const placementOffsets = [
            { x: 0, y: -1, z: 0 },   // floor
            { x: 1, y: 0, z: 0 },     // wall
            { x: -1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: 0, y: 0, z: -1 },
          ]

          for (const offset of placementOffsets) {
            const supportPos = currentPos.offset(offset.x, offset.y, offset.z).floored()
            const supportBlock = bot.blockAt(supportPos)
            if (!supportBlock || supportBlock.boundingBox !== 'block') continue

            // Find the air block adjacent to this support where we place the torch
            const torchPos = supportPos.offset(-offset.x, -offset.y, -offset.z)
            const airBlock = bot.blockAt(torchPos)
            if (!airBlock || airBlock.name !== 'air') continue

            try {
              const torchItem = mcData.itemsByName['torch']
              if (!torchItem) break
              await bot.equip(torchItem.id, 'hand')
              const faceVector = { x: -offset.x, y: -offset.y, z: -offset.z }
              await bot.placeBlock(supportBlock, faceVector)
              torchesPlaced++
              lastTorchPos = currentPos.clone()
              logger.debug({ pos: torchPos, total: torchesPlaced }, 'Placed torch')
            } catch {
              // Placement failed, continue navigating
            }
            break
          }
        }
      } catch {
        // Ignore torch placement errors, navigation is the priority
      }
    }, 2000) : null

    try {
      await new Promise((resolve, reject) => {
        const onArrived = () => { cleanup(); resolve() }
        const onStopped = () => { cleanup(); resolve() }
        const onNoPath = () => { cleanup(); reject(new Error('No path through cave')) }
        const cleanup = () => {
          bot.removeListener('goal_reached', onArrived)
          bot.removeListener('path_stop', onStopped)
          bot.removeListener('path_update', onNoPath)
        }
        bot.on('goal_reached', onArrived)
        bot.on('path_stop', onStopped)
        bot.on('path_update', (r) => { if (r.status === 'noPath') onNoPath() })
      })
    } finally {
      if (torchInterval) clearInterval(torchInterval)
    }

    const dist = bot.entity.position.distanceTo({ x, y, z })
    logger.info({ distance: dist, torchesPlaced }, 'Cave navigation complete')
    return {
      success: true,
      message: `Navigated cave to (${x}, ${y}, ${z}), placed ${torchesPlaced} torches`,
      distanceFromTarget: dist,
      torchesPlaced,
    }
  },
})

// ─── avoid_hazards ───────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'avoid_hazards',
  name: 'Avoid Hazards',
  category: 'movement',
  description: 'Configure pathfinder movements to avoid lava, fire, and cactus',
  arguments: {},
  requires: [],
  permissions: [],
  timeout: 5000,

  async execute(bot, args, context) {
    const { Movements } = context
    const { logger, mcData } = context

    const movements = new Movements(bot, context?.mcData || minecraftData(bot.version))
    movements.allowSprinting = false

    // Mark hazardous blocks that pathfinder must not break or walk through
    const hazardBlocks = [
      'lava', 'fire', 'soul_fire', 'cactus', 'magma_block',
      'sweet_berry_bush', 'wither_rose', 'campfire', 'soul_campfire',
      'powder_snow',
    ]

    const blockedIds = []
    for (const blockName of hazardBlocks) {
      const block = mcData.blocksByName[blockName]
      if (block) {
        movements.blocksCantBreak.add(block.id)
        blockedIds.push(blockName)
      }
    }

    // Apply the movements to pathfinder
    bot.pathfinder.setMovements(movements)

    logger.info({ hazardsAvoided: blockedIds }, 'Hazard avoidance configured')
    return {
      success: true,
      message: `Configured pathfinder to avoid ${blockedIds.length} hazard types`,
      hazardsAvoided: blockedIds,
    }
  },
})

// ─── detect_stuck ────────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'detect_stuck',
  name: 'Detect Stuck',
  category: 'movement',
  description: 'Monitor bot position over time to detect if it is stuck',
  arguments: {
    checkDuration: { type: 'number', required: false, default: 5000, description: 'Duration in ms to monitor movement' },
    minDistance: { type: 'number', required: false, default: 1.5, description: 'Minimum distance the bot should move to not be considered stuck' },
  },
  requires: [],
  permissions: [],
  timeout: 15000,

  async execute(bot, args, context) {
    const { logger, wait } = context

    const checkDuration = args.checkDuration ?? 5000
    const minDistance = args.minDistance ?? 1.5
    const startPos = bot.entity.position.clone()
    const startTime = Date.now()

    // Sample positions over the monitoring period
    const samples = [{ pos: startPos.clone(), time: startTime }]
    const sampleInterval = Math.max(500, Math.floor(checkDuration / 5))
    const numSamples = Math.floor(checkDuration / sampleInterval)

    for (let i = 0; i < numSamples; i++) {
      await wait(sampleInterval)
      samples.push({ pos: bot.entity.position.clone(), time: Date.now() })
    }

    const endPos = bot.entity.position.clone()
    const totalDistance = startPos.distanceTo(endPos)
    const elapsed = Date.now() - startTime

    // Check if there was meaningful movement between any consecutive samples
    let maxSegmentDist = 0
    for (let i = 1; i < samples.length; i++) {
      const segDist = samples[i - 1].pos.distanceTo(samples[i].pos)
      if (segDist > maxSegmentDist) maxSegmentDist = segDist
    }

    const stuck = totalDistance < minDistance && maxSegmentDist < minDistance / 2

    logger.info({
      stuck,
      totalDistance,
      maxSegmentDist,
      elapsed,
    }, stuck ? 'Bot appears stuck' : 'Bot is moving normally')

    return {
      success: true,
      stuck,
      totalDistance,
      maxSegmentDist,
      duration: elapsed,
      position: { x: endPos.x, y: endPos.y, z: endPos.z },
    }
  },
})

// ─── recover_stuck ───────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'recover_stuck',
  name: 'Recover from Stuck',
  category: 'movement',
  description: 'Attempt multiple recovery strategies when the bot is stuck',
  arguments: {},
  requires: [],
  permissions: [],
  timeout: 30000,

  async execute(bot, args, context) {
    const { GoalXZ, Movements } = context
    const { logger, mcData, wait } = context

    const startPos = bot.entity.position.clone()
    bot.pathfinder.setGoal(null)

    // Strategy 1: Jump
    logger.debug('Stuck recovery: trying jump')
    bot.setControlState('jump', true)
    await wait(600)
    bot.setControlState('jump', false)
    await wait(400)

    let currentPos = bot.entity.position.clone()
    if (startPos.distanceTo(currentPos) > 1.5) {
      logger.info('Stuck recovery: jump worked')
      return { success: true, method: 'jump', moved: startPos.distanceTo(currentPos) }
    }

    // Strategy 2: Dig block below (if standing on something)
    logger.debug('Stuck recovery: trying dig below')
    try {
      const belowPos = bot.entity.position.offset(0, -1, 0).floored()
      const blockBelow = bot.blockAt(belowPos)
      if (blockBelow && blockBelow.diggable) {
        await bot.dig(blockBelow)
        await wait(500)
        currentPos = bot.entity.position.clone()
        if (startPos.distanceTo(currentPos) > 1.5) {
          logger.info('Stuck recovery: dig below worked')
          return { success: true, method: 'dig_below', moved: startPos.distanceTo(currentPos) }
        }
      }
    } catch {
      // Dig failed, try next strategy
    }

    // Strategy 3: Dig forward (in the direction the bot is facing)
    logger.debug('Stuck recovery: trying dig forward')
    try {
      const yaw = bot.entity.yaw
      const dx = -Math.sin(yaw)
      const dz = -Math.cos(yaw)
      const forwardPos = bot.entity.position.offset(dx, 0, dz).floored()
      const forwardBlock = bot.blockAt(forwardPos)
      if (forwardBlock && forwardBlock.diggable) {
        await bot.dig(forwardBlock)
        // Also check block above in case we need head clearance
        const aboveForward = bot.blockAt(forwardPos.offset(0, 1, 0))
        if (aboveForward && aboveForward.diggable && aboveForward.name !== 'air') {
          await bot.dig(aboveForward)
        }
        bot.setControlState('forward', true)
        await wait(500)
        bot.setControlState('forward', false)
        currentPos = bot.entity.position.clone()
        if (startPos.distanceTo(currentPos) > 1.5) {
          logger.info('Stuck recovery: dig forward worked')
          return { success: true, method: 'dig_forward', moved: startPos.distanceTo(currentPos) }
        }
      }
    } catch {
      // Dig failed, try next strategy
    }

    // Strategy 4: Random direction via pathfinder
    logger.debug('Stuck recovery: trying random direction')
    const angle = Math.random() * 2 * Math.PI
    const randomDist = 10 + Math.random() * 10
    const randomX = Math.floor(bot.entity.position.x + Math.cos(angle) * randomDist)
    const randomZ = Math.floor(bot.entity.position.z + Math.sin(angle) * randomDist)

    const movements = new Movements(bot, context?.mcData || minecraftData(bot.version))
    movements.canDig = true
    bot.pathfinder.setMovements(movements)
    bot.pathfinder.setGoal(new GoalXZ(randomX, randomZ))

    await new Promise((resolve) => {
      const timer = setTimeout(() => { cleanup(); resolve() }, 8000)
      const onDone = () => { cleanup(); resolve() }
      const cleanup = () => {
        clearTimeout(timer)
        bot.removeListener('goal_reached', onDone)
        bot.removeListener('path_stop', onDone)
      }
      bot.on('goal_reached', onDone)
      bot.on('path_stop', onDone)
    })

    currentPos = bot.entity.position.clone()
    const finalDist = startPos.distanceTo(currentPos)

    if (finalDist > 2) {
      logger.info({ moved: finalDist }, 'Stuck recovery: random direction worked')
      return { success: true, method: 'random_direction', moved: finalDist }
    }

    logger.warn('All stuck recovery strategies failed')
    return { success: false, method: 'none', moved: finalDist, error: 'All recovery strategies failed' }
  },

  async recover(bot, args, context) {
    // Last resort: teleport if we have op (unlikely but handle it)
    const { logger } = context
    logger.warn('Stuck recovery skill itself failed — bot may need manual intervention')
    bot.pathfinder.setGoal(null)
    bot.clearControlStates()
  },
})

// ─── swim ────────────────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'swim',
  name: 'Swim',
  category: 'movement',
  description: 'Navigate through water using pathfinder configured for swimming',
  arguments: {
    x: { type: 'number', required: true, description: 'Target X coordinate' },
    y: { type: 'number', required: true, description: 'Target Y coordinate' },
    z: { type: 'number', required: true, description: 'Target Z coordinate' },
  },
  requires: [],
  permissions: [],
  timeout: 120000,

  async execute(bot, args, context) {
    const { GoalBlock, Movements } = context
    const { logger } = context
    const { x, y, z } = args

    const movements = new Movements(bot, context?.mcData || minecraftData(bot.version))
    movements.canSwim = true
    movements.allowSprinting = false
    bot.pathfinder.setMovements(movements)

    const goal = new GoalBlock(x, y, z)
    bot.pathfinder.setGoal(goal)

    logger.info({ x, y, z }, 'Swimming to target')

    await new Promise((resolve, reject) => {
      const onArrived = () => { cleanup(); resolve() }
      const onStopped = () => { cleanup(); resolve() }
      const onNoPath = () => { cleanup(); reject(new Error('No swim path found')) }
      const cleanup = () => {
        bot.removeListener('goal_reached', onArrived)
        bot.removeListener('path_stop', onStopped)
        bot.removeListener('path_update', onNoPath)
      }
      bot.on('goal_reached', onArrived)
      bot.on('path_stop', onStopped)
      bot.on('path_update', (r) => { if (r.status === 'noPath') onNoPath() })
    })

    const dist = bot.entity.position.distanceTo({ x, y, z })
    logger.info({ distance: dist }, 'Swimming complete')
    return {
      success: true,
      message: `Swam to (${x}, ${y}, ${z})`,
      distanceFromTarget: dist,
    }
  },
})

// ─── climb ───────────────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'climb',
  name: 'Climb',
  category: 'movement',
  description: 'Navigate vertically by pillar jumping up or digging/descending down',
  arguments: {
    height: { type: 'number', required: true, description: 'Number of blocks to climb (positive = up, negative = down)' },
    direction: { type: 'string', required: false, default: 'up', description: "'up' or 'down'" },
  },
  requires: [],
  permissions: [],
  timeout: 60000,

  async execute(bot, args, context) {
    const { GoalBlock, Movements } = context
    const { logger, mcData, wait } = context

    const direction = args.direction ?? 'up'
    const height = Math.abs(args.height)
    const pos = bot.entity.position.floored()
    const targetY = direction === 'up' ? pos.y + height : pos.y - height

    // First try using pathfinder — it can handle stairs and ladders
    const movements = new Movements(bot, context?.mcData || minecraftData(bot.version))
    movements.canDig = true
    bot.pathfinder.setMovements(movements)

    const goal = new GoalBlock(pos.x, targetY, pos.z)
    bot.pathfinder.setGoal(goal)

    logger.info({ direction, height, targetY }, 'Climbing')

    // Give pathfinder a chance first
    const pathfinderResult = await new Promise((resolve) => {
      const timer = setTimeout(() => { cleanup(); resolve('timeout') }, 10000)
      const onArrived = () => { cleanup(); resolve('arrived') }
      const onStopped = () => { cleanup(); resolve('stopped') }
      const onNoPath = () => { cleanup(); resolve('noPath') }
      const cleanup = () => {
        clearTimeout(timer)
        bot.removeListener('goal_reached', onArrived)
        bot.removeListener('path_stop', onStopped)
        bot.removeListener('path_update', onNoPath)
      }
      bot.on('goal_reached', onArrived)
      bot.on('path_stop', onStopped)
      bot.on('path_update', (r) => { if (r.status === 'noPath') onNoPath() })
    })

    if (pathfinderResult === 'arrived') {
      logger.info('Climb complete via pathfinder')
      return { success: true, message: `Climbed ${direction} ${height} blocks via pathfinder`, method: 'pathfinder' }
    }

    // Pathfinder couldn't do it — manual approach
    bot.pathfinder.setGoal(null)

    if (direction === 'up') {
      // Pillar jump: look down, jump, place block under feet
      logger.debug('Attempting manual pillar jump')
      let blocksPlaced = 0
      const scaffoldNames = ['cobblestone', 'dirt', 'netherrack', 'stone', 'cobbled_deepslate', 'sand', 'gravel']
      let scaffoldItem = null

      for (const name of scaffoldNames) {
        const item = mcData.itemsByName[name]
        if (!item) continue
        const invItem = bot.inventory.items().find(i => i.type === item.id)
        if (invItem) {
          scaffoldItem = invItem
          break
        }
      }

      if (!scaffoldItem) {
        return { success: false, error: 'No blocks available for pillar jumping and pathfinder failed' }
      }

      for (let i = 0; i < height; i++) {
        try {
          // Jump and place block below
          await bot.equip(scaffoldItem, 'hand')
          bot.setControlState('jump', true)
          await wait(350)

          const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0).floored())
          if (blockBelow && blockBelow.name === 'air') {
            // Place block on the block two below us
            const supportBlock = bot.blockAt(bot.entity.position.offset(0, -2, 0).floored())
            if (supportBlock && supportBlock.boundingBox === 'block') {
              await bot.placeBlock(supportBlock, { x: 0, y: 1, z: 0 })
              blocksPlaced++
            }
          }

          bot.setControlState('jump', false)
          await wait(250)

          // Refresh scaffold item reference
          const updatedInvItem = bot.inventory.items().find(i => i.type === scaffoldItem.type)
          if (!updatedInvItem) {
            // Try to find another scaffold block
            let found = false
            for (const name of scaffoldNames) {
              const item = mcData.itemsByName[name]
              if (!item) continue
              const invItem = bot.inventory.items().find(i => i.type === item.id)
              if (invItem) {
                scaffoldItem = invItem
                found = true
                break
              }
            }
            if (!found) break
          } else {
            scaffoldItem = updatedInvItem
          }
        } catch (err) {
          bot.setControlState('jump', false)
          logger.debug({ error: err.message }, 'Pillar jump step failed')
          break
        }
      }

      const reached = bot.entity.position.y - pos.y
      return {
        success: reached >= height * 0.5,
        message: `Pillar jumped ${Math.round(reached)} of ${height} blocks`,
        method: 'pillar_jump',
        blocksClimbed: Math.round(reached),
        blocksPlaced,
      }
    } else {
      // Going down: dig straight down (with safety checks)
      logger.debug('Attempting manual descent')
      let blocksDug = 0

      for (let i = 0; i < height; i++) {
        try {
          const belowBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0).floored())
          if (!belowBlock || !belowBlock.diggable) break

          // Safety check: don't dig into lava or water below
          const twoBelow = bot.blockAt(bot.entity.position.offset(0, -2, 0).floored())
          if (twoBelow && (twoBelow.name === 'lava' || twoBelow.name === 'flowing_lava')) {
            logger.warn('Lava detected below — stopping descent')
            break
          }

          await bot.dig(belowBlock)
          blocksDug++
          await wait(300) // Let gravity pull us down
        } catch (err) {
          logger.debug({ error: err.message }, 'Descent dig step failed')
          break
        }
      }

      const descended = pos.y - bot.entity.position.y
      return {
        success: descended >= height * 0.5,
        message: `Descended ${Math.round(descended)} of ${height} blocks`,
        method: 'dig_down',
        blocksDescended: Math.round(descended),
        blocksDug,
      }
    }
  },
})

// ─── avoid_danger ────────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'avoid_danger',
  name: 'Avoid Danger',
  category: 'movement',
  description: 'Scan for nearby hazards (lava, fire, void) and pathfind away from them',
  arguments: {
    radius: { type: 'number', required: false, default: 5, description: 'Scan radius for dangers' },
  },
  requires: [],
  permissions: [],
  timeout: 30000,

  async execute(bot, args, context) {
    const { GoalXZ, Movements } = context
    const { logger, mcData, findBlocks } = context

    const radius = args.radius ?? 5
    const dangerBlockNames = ['lava', 'flowing_lava', 'fire', 'soul_fire', 'magma_block', 'cactus']
    const dangerPositions = []

    // Scan for dangerous blocks
    for (const blockName of dangerBlockNames) {
      const positions = findBlocks(blockName, radius, 50)
      if (positions && positions.length > 0) {
        for (const pos of positions) {
          dangerPositions.push({ name: blockName, pos })
        }
      }
    }

    // Check for void (Y < -60 in 1.18+, Y < 0 in older)
    const isNearVoid = bot.entity.position.y < 5

    if (dangerPositions.length === 0 && !isNearVoid) {
      logger.info('No dangers detected nearby')
      return { success: true, message: 'No dangers detected', dangers: [] }
    }

    // Calculate the average danger direction and move away from it
    let dangerCenterX = 0
    let dangerCenterZ = 0
    const botPos = bot.entity.position

    if (dangerPositions.length > 0) {
      for (const dp of dangerPositions) {
        dangerCenterX += dp.pos.x
        dangerCenterZ += dp.pos.z
      }
      dangerCenterX /= dangerPositions.length
      dangerCenterZ /= dangerPositions.length
    } else {
      // Near void — just go in a random horizontal direction
      dangerCenterX = botPos.x
      dangerCenterZ = botPos.z
    }

    // Move in the opposite direction from the danger center
    const dx = botPos.x - dangerCenterX
    const dz = botPos.z - dangerCenterZ
    const dist = Math.sqrt(dx * dx + dz * dz) || 1
    const escapeDistance = radius * 2
    const safeX = Math.floor(botPos.x + (dx / dist) * escapeDistance)
    const safeZ = Math.floor(botPos.z + (dz / dist) * escapeDistance)

    const movements = new Movements(bot, context?.mcData || minecraftData(bot.version))
    movements.allowSprinting = true
    // Block hazardous blocks from being walked through
    for (const blockName of dangerBlockNames) {
      const block = mcData.blocksByName[blockName]
      if (block) movements.blocksCantBreak.add(block.id)
    }
    bot.pathfinder.setMovements(movements)

    const goal = new GoalXZ(safeX, safeZ)
    bot.pathfinder.setGoal(goal)

    logger.info({
      dangers: dangerPositions.length,
      escapeTo: { x: safeX, z: safeZ },
      isNearVoid,
    }, 'Escaping danger')

    await new Promise((resolve) => {
      const timer = setTimeout(() => { cleanup(); resolve() }, 10000)
      const onDone = () => { cleanup(); resolve() }
      const cleanup = () => {
        clearTimeout(timer)
        bot.removeListener('goal_reached', onDone)
        bot.removeListener('path_stop', onDone)
      }
      bot.on('goal_reached', onDone)
      bot.on('path_stop', onDone)
    })

    const dangerTypes = [...new Set(dangerPositions.map(d => d.name))]
    logger.info({ dangerTypes, moved: bot.entity.position.distanceTo(botPos) }, 'Danger avoidance complete')
    return {
      success: true,
      message: `Escaped from ${dangerPositions.length} danger sources`,
      dangersDetected: dangerPositions.length,
      dangerTypes,
      isNearVoid,
    }
  },
})
