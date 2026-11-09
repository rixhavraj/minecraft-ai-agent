import { skillRegistry } from './registry.js'
import { logger } from '../utils/logger.js'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

const { goals: { GoalGetToBlock, GoalBlock, GoalNear } } = pathfinderPackage

const log = logger.child({ component: 'ResourceGathering' })

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Tool tiers ordered from best to worst.
 */
const TOOL_TIERS = ['netherite', 'diamond', 'iron', 'stone', 'wooden']

/**
 * Tool type mapping for block categories.
 */
const TOOL_FOR_CATEGORY = {
  pickaxe: [
    'stone', 'cobblestone', 'deepslate', 'cobbled_deepslate', 'andesite',
    'diorite', 'granite', 'coal_ore', 'deepslate_coal_ore', 'iron_ore',
    'deepslate_iron_ore', 'copper_ore', 'deepslate_copper_ore', 'gold_ore',
    'deepslate_gold_ore', 'redstone_ore', 'deepslate_redstone_ore',
    'lapis_ore', 'deepslate_lapis_ore', 'diamond_ore', 'deepslate_diamond_ore',
    'emerald_ore', 'deepslate_emerald_ore', 'nether_quartz_ore', 'nether_gold_ore',
    'obsidian', 'netherrack', 'basalt', 'blackstone',
  ],
  axe: [
    'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log',
    'dark_oak_log', 'mangrove_log', 'cherry_log', 'oak_planks', 'birch_planks',
    'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks',
    'oak_wood', 'birch_wood', 'spruce_wood', 'jungle_wood', 'acacia_wood',
    'dark_oak_wood', 'crafting_table', 'chest', 'barrel',
  ],
  shovel: [
    'dirt', 'grass_block', 'sand', 'red_sand', 'gravel', 'clay',
    'soul_sand', 'soul_soil', 'mycelium', 'podzol', 'coarse_dirt',
    'rooted_dirt', 'mud', 'farmland', 'dirt_path',
  ],
}

/**
 * Minimum pickaxe tier required to mine specific ores.
 */
const ORE_TOOL_REQUIREMENTS = {
  coal:     'wooden_pickaxe',
  iron:     'stone_pickaxe',
  copper:   'stone_pickaxe',
  gold:     'iron_pickaxe',
  redstone: 'iron_pickaxe',
  lapis:    'iron_pickaxe',
  diamond:  'iron_pickaxe',
  emerald:  'iron_pickaxe',
}

/**
 * Minimum pickaxe tier index for ore mining. Lower index = higher tier.
 */
const TIER_RANK = { netherite: 0, diamond: 1, iron: 2, stone: 3, wooden: 4 }

/**
 * The minimum tier rank a pickaxe must have for each ore type.
 * E.g. diamond needs iron_pickaxe (rank 2) or better.
 */
const ORE_MIN_TIER_RANK = {
  coal:     4, // wooden or better
  iron:     3, // stone or better
  copper:   3,
  gold:     2, // iron or better
  redstone: 2,
  lapis:    2,
  diamond:  2,
  emerald:  2,
}

/**
 * Suggested Y-levels for ore searching.
 */
const ORE_Y_LEVELS = {
  coal:     { min: 0, max: 320 },
  iron:     { min: -64, max: 320 },
  copper:   { min: -16, max: 112 },
  gold:     { min: -64, max: 32 },
  redstone: { min: -64, max: 16 },
  lapis:    { min: -64, max: 64 },
  diamond:  { min: -64, max: 16 },
  emerald:  { min: -16, max: 320 },
}

/**
 * Determine which tool type is best for a given block name.
 * @param {string} blockName
 * @returns {'pickaxe'|'axe'|'shovel'|null}
 */
function getToolTypeForBlock(blockName) {
  for (const [toolType, blocks] of Object.entries(TOOL_FOR_CATEGORY)) {
    if (blocks.includes(blockName)) return toolType
  }
  return null
}

/**
 * Wait for drops to spawn then walk to the mined position to collect them.
 * @param {import('mineflayer').Bot} bot
 * @param {Vec3} position
 * @param {number} timeoutMs
 */
async function collectDrops(bot, position, timeoutMs = 3000) {
  await new Promise(r => setTimeout(r, 500))
  try {
    const goal = new GoalNear(position.x, position.y, position.z, 1)
    bot.pathfinder.setGoal(goal)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bot.pathfinder.setGoal(null)
        resolve()
      }, timeoutMs)
      bot.once('goal_reached', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  } catch {
    // Best effort — items auto-collect when nearby
  }
  // Small wait for item pickup
  await new Promise(r => setTimeout(r, 300))
}

/**
 * Navigate to a block position using pathfinder.
 * Resolves when the bot reaches the goal or times out.
 * @param {import('mineflayer').Bot} bot
 * @param {Vec3} position
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true if reached
 */
async function navigateTo(bot, position, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const goal = new GoalGetToBlock(position.x, position.y, position.z)
    bot.pathfinder.setGoal(goal)

    const timeout = setTimeout(() => {
      bot.pathfinder.setGoal(null)
      bot.removeListener('goal_reached', onReach)
      bot.removeListener('path_update', onStuck)
      resolve(false)
    }, timeoutMs)

    function onReach() {
      clearTimeout(timeout)
      bot.removeListener('path_update', onStuck)
      resolve(true)
    }

    function onStuck(result) {
      if (result.status === 'noPath') {
        clearTimeout(timeout)
        bot.removeListener('goal_reached', onReach)
        bot.pathfinder.setGoal(null)
        resolve(false)
      }
    }

    bot.once('goal_reached', onReach)
    bot.on('path_update', onStuck)
  })
}

/**
 * Equip the best available tool of a given type from inventory.
 * @param {import('mineflayer').Bot} bot
 * @param {'pickaxe'|'axe'|'shovel'} toolType
 * @returns {Promise<import('prismarine-item').Item|null>} equipped item or null
 */
async function equipBestToolOfType(bot, toolType) {
  const items = bot.inventory.items()
  let bestItem = null
  let bestRank = Infinity

  for (const item of items) {
    for (const tier of TOOL_TIERS) {
      if (item.name === `${tier}_${toolType}`) {
        const rank = TIER_RANK[tier]
        if (rank < bestRank) {
          bestRank = rank
          bestItem = item
        }
        break
      }
    }
  }

  if (bestItem) {
    await bot.equip(bestItem, 'hand')
    return bestItem
  }
  return null
}

/**
 * Equip the best tool for mining a specific block.
 * Falls back to bare hand if no tool is found.
 * @param {import('mineflayer').Bot} bot
 * @param {string} blockName
 * @returns {Promise<import('prismarine-item').Item|null>}
 */
async function equipBestToolForBlock(bot, blockName) {
  const toolType = getToolTypeForBlock(blockName)
  if (!toolType) return null
  return equipBestToolOfType(bot, toolType)
}

/**
 * Check if bot has a pickaxe at or above the required tier for an ore.
 * @param {import('mineflayer').Bot} bot
 * @param {string} oreType coal|iron|copper|gold|redstone|lapis|diamond|emerald
 * @returns {{ hasTool: boolean, bestPickaxe: string|null, requiredTool: string }}
 */
function checkPickaxeForOre(bot, oreType) {
  const requiredTool = ORE_TOOL_REQUIREMENTS[oreType]
  const minRank = ORE_MIN_TIER_RANK[oreType]
  const items = bot.inventory.items()

  let bestPickaxe = null
  let bestRank = Infinity

  for (const item of items) {
    for (const tier of TOOL_TIERS) {
      if (item.name === `${tier}_pickaxe`) {
        const rank = TIER_RANK[tier]
        if (rank < bestRank) {
          bestRank = rank
          bestPickaxe = item.name
        }
        break
      }
    }
  }

  return {
    hasTool: bestRank <= minRank,
    bestPickaxe,
    requiredTool,
  }
}

/**
 * Count items in inventory matching a given name.
 * @param {import('mineflayer').Bot} bot
 * @param {string} itemName
 * @returns {number}
 */
function countInventoryItem(bot, itemName) {
  return bot.inventory.items()
    .filter(item => item.name === itemName)
    .reduce((sum, item) => sum + item.count, 0)
}

/**
 * Find blocks by name within a search radius.
 * @param {import('mineflayer').Bot} bot
 * @param {object} mcData minecraft-data instance
 * @param {string} blockName
 * @param {number} maxDistance
 * @param {number} count
 * @returns {Vec3[]}
 */
function findBlocks(bot, mcData, blockName, maxDistance = 64, count = 32) {
  const blockType = mcData.blocksByName[blockName]
  if (!blockType) return []
  return bot.findBlocks({
    matching: blockType.id,
    maxDistance,
    count,
  })
}

/**
 * Dig a block safely with error handling.
 * @param {import('mineflayer').Bot} bot
 * @param {import('prismarine-block').Block} block
 * @returns {Promise<boolean>}
 */
async function digBlock(bot, block) {
  if (!block || block.name === 'air') return false
  try {
    if (bot.canDigBlock(block)) {
      await bot.dig(block, true)
      return true
    }
  } catch (err) {
    log.warn({ err: err.message, block: block.name, pos: block.position }, 'Failed to dig block')
  }
  return false
}

// ─── Skills ────────────────────────────────────────────────────────────────────

// 1. collect_wood
skillRegistry.register({
  id: 'collect_wood',
  name: 'Collect Wood',
  category: 'resource_gathering',
  description: 'Find and chop a specified type of wood log. Navigates to trees, chops all connected logs (including up the trunk), and collects the drops.',
  arguments: {
    woodType: { type: 'string', enum: ['oak', 'birch', 'spruce', 'jungle', 'acacia', 'dark_oak'], default: 'oak' },
    quantity: { type: 'number', default: 16, min: 1, max: 256 },
  },
  requires: [],
  permissions: ['*'],
  timeout: 120_000,
  execute: async (bot, args, context) => {
    const woodType = args.woodType || 'oak'
    const quantity = args.quantity || 16
    const logName = `${woodType}_log`
    const mcData = context.mcData

    const startCount = countInventoryItem(bot, logName)
    if (startCount >= quantity) {
      return {
        success: true,
        collected: 0,
        existing: startCount,
        requested: quantity,
        itemName: logName,
        message: `Already have ${startCount} ${logName}`,
      }
    }
    let collected = 0

    for (let attempt = 0; attempt < 10 && collected < quantity; attempt++) {
      const positions = findBlocks(bot, mcData, logName, 64, 16)
      if (positions.length === 0) {
        log.info({ woodType }, 'No more trees found nearby')
        break
      }

      // Sort by distance
      const botPos = bot.entity.position
      positions.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b))

      for (const pos of positions) {
        if (collected >= quantity) break

        // Navigate to the base log
        const reached = await navigateTo(bot, pos)
        if (!reached) continue

        // Equip best axe (or bare hand)
        await equipBestToolForBlock(bot, logName)

        // Mine this log and all connected logs above it (tree trunk)
        let currentPos = pos.clone()
        const maxHeight = 30 // max tree height to check

        for (let dy = 0; dy < maxHeight; dy++) {
          const checkPos = currentPos.offset(0, dy, 0)
          const block = bot.blockAt(checkPos)
          if (!block || block.name !== logName) break

          // Navigate close enough if needed
          if (bot.entity.position.distanceTo(checkPos) > 5) {
            await navigateTo(bot, checkPos, 8000)
          }

          await equipBestToolForBlock(bot, logName)
          const dug = await digBlock(bot, block)
          if (dug) {
            collected++
            await collectDrops(bot, checkPos, 2000)
          }

          if (collected >= quantity) break
        }
      }
    }

    const endCount = countInventoryItem(bot, logName)
    const actualCollected = endCount - startCount

    return {
      success: endCount >= quantity,
      collected: actualCollected,
      existing: startCount,
      requested: quantity,
      itemName: logName,
      message: actualCollected >= quantity
        ? `Collected ${actualCollected} ${logName}`
        : `Could only collect ${actualCollected}/${quantity} ${logName}`,
    }
  },
  verify: async (bot, args, context) => {
    const logName = `${args.woodType || 'oak'}_log`
    const quantity = args.quantity || 16
    const count = countInventoryItem(bot, logName)
    return { verified: count >= quantity, current: count, required: quantity }
  },
})

// 2. collect_stone
skillRegistry.register({
  id: 'collect_stone',
  name: 'Collect Stone',
  category: 'resource_gathering',
  description: 'Mine stone blocks to get cobblestone. Requires at least a wooden pickaxe.',
  arguments: {
    quantity: { type: 'number', default: 16, min: 1, max: 256 },
  },
  requires: [],
  permissions: ['*'],
  timeout: 120_000,
  execute: async (bot, args, context) => {
    const quantity = args.quantity || 16
    const mcData = context.mcData

    // Check for pickaxe
    const equipped = await equipBestToolOfType(bot, 'pickaxe')
    if (!equipped) {
      return { success: false, message: 'No pickaxe available. Craft at least a wooden_pickaxe first.' }
    }

    const startCount = countInventoryItem(bot, 'cobblestone')
    let mined = 0

    for (let attempt = 0; attempt < 15 && mined < quantity; attempt++) {
      // Search for stone, cobblestone, or deepslate
      let positions = findBlocks(bot, mcData, 'stone', 48, 32)
      if (positions.length === 0) {
        positions = findBlocks(bot, mcData, 'deepslate', 48, 32)
      }
      if (positions.length === 0) {
        log.info('No stone found nearby')
        break
      }

      const botPos = bot.entity.position
      positions.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b))

      for (const pos of positions) {
        if (mined >= quantity) break

        const reached = await navigateTo(bot, pos)
        if (!reached) continue

        await equipBestToolOfType(bot, 'pickaxe')
        const block = bot.blockAt(pos)
        if (block && (block.name === 'stone' || block.name === 'deepslate')) {
          const dug = await digBlock(bot, block)
          if (dug) {
            mined++
            await collectDrops(bot, pos, 1500)
          }
        }
      }
    }

    const endCount = countInventoryItem(bot, 'cobblestone')
    const actualMined = endCount - startCount

    return {
      success: actualMined > 0,
      collected: actualMined,
      requested: quantity,
      itemName: 'cobblestone',
      message: actualMined >= quantity
        ? `Mined ${actualMined} cobblestone`
        : `Could only mine ${actualMined}/${quantity} cobblestone`,
    }
  },
  verify: async (bot, args) => {
    const quantity = args.quantity || 16
    const count = countInventoryItem(bot, 'cobblestone')
    return { verified: count >= quantity, current: count, required: quantity }
  },
})

// 3. collect_ore
skillRegistry.register({
  id: 'collect_ore',
  name: 'Collect Ore',
  category: 'resource_gathering',
  description: 'Mine a specific ore type. Checks tool requirements before mining and searches at appropriate Y levels.',
  arguments: {
    ore: { type: 'string', enum: ['coal', 'iron', 'copper', 'gold', 'redstone', 'lapis', 'diamond', 'emerald'], required: true },
    quantity: { type: 'number', default: 8, min: 1, max: 128 },
  },
  requires: [],
  permissions: ['*'],
  timeout: 180_000,
  execute: async (bot, args, context) => {
    const ore = args.ore
    const quantity = args.quantity || 8
    const mcData = context.mcData

    if (!ore || !ORE_TOOL_REQUIREMENTS[ore]) {
      return { success: false, message: `Unknown ore type: ${ore}` }
    }

    // Check tool requirements
    const toolCheck = checkPickaxeForOre(bot, ore)
    if (!toolCheck.hasTool) {
      return {
        success: false,
        message: `Need ${toolCheck.requiredTool} or better to mine ${ore}_ore. Best pickaxe: ${toolCheck.bestPickaxe || 'none'}`,
        requiredTool: toolCheck.requiredTool,
      }
    }

    // Determine ore block names (regular + deepslate variant)
    const oreBlockName = `${ore}_ore`
    const deepslateOreBlockName = `deepslate_${ore}_ore`

    // Determine expected drop item
    const dropItems = {
      coal: 'coal',
      iron: 'raw_iron',
      copper: 'raw_copper',
      gold: 'raw_gold',
      redstone: 'redstone',
      lapis: 'lapis_lazuli',
      diamond: 'diamond',
      emerald: 'emerald',
    }
    const dropItem = dropItems[ore]

    const startCount = countInventoryItem(bot, dropItem)
    let mined = 0

    for (let attempt = 0; attempt < 20 && mined < quantity; attempt++) {
      // Search for both regular and deepslate variants
      let positions = findBlocks(bot, mcData, oreBlockName, 64, 16)
      const deepPositions = findBlocks(bot, mcData, deepslateOreBlockName, 64, 16)
      positions = positions.concat(deepPositions)

      if (positions.length === 0) {
        log.info({ ore }, 'No ore blocks found nearby')
        break
      }

      const botPos = bot.entity.position
      positions.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b))

      for (const pos of positions) {
        if (mined >= quantity) break

        const reached = await navigateTo(bot, pos)
        if (!reached) continue

        // Equip best pickaxe
        await equipBestToolOfType(bot, 'pickaxe')

        const block = bot.blockAt(pos)
        if (block && (block.name === oreBlockName || block.name === deepslateOreBlockName)) {
          const dug = await digBlock(bot, block)
          if (dug) {
            mined++
            await collectDrops(bot, pos, 2000)
          }
        }
      }
    }

    const endCount = countInventoryItem(bot, dropItem)
    const actualMined = endCount - startCount

    return {
      success: actualMined > 0,
      collected: actualMined,
      requested: quantity,
      itemName: dropItem,
      oreType: ore,
      message: actualMined >= quantity
        ? `Collected ${actualMined} ${dropItem}`
        : `Could only collect ${actualMined}/${quantity} ${dropItem}`,
    }
  },
  verify: async (bot, args) => {
    const dropItems = {
      coal: 'coal', iron: 'raw_iron', copper: 'raw_copper', gold: 'raw_gold',
      redstone: 'redstone', lapis: 'lapis_lazuli', diamond: 'diamond', emerald: 'emerald',
    }
    const dropItem = dropItems[args.ore]
    const quantity = args.quantity || 8
    const count = countInventoryItem(bot, dropItem)
    return { verified: count >= quantity, current: count, required: quantity }
  },
})

// 4. collect_sand
skillRegistry.register({
  id: 'collect_sand',
  name: 'Collect Sand',
  category: 'resource_gathering',
  description: 'Dig sand blocks. Uses a shovel if available for faster mining.',
  arguments: {
    quantity: { type: 'number', default: 16, min: 1, max: 256 },
  },
  requires: [],
  permissions: ['*'],
  timeout: 120_000,
  execute: async (bot, args, context) => {
    const quantity = args.quantity || 16
    const mcData = context.mcData

    const startCount = countInventoryItem(bot, 'sand')
    let mined = 0

    for (let attempt = 0; attempt < 15 && mined < quantity; attempt++) {
      const positions = findBlocks(bot, mcData, 'sand', 64, 32)
      if (positions.length === 0) {
        log.info('No sand found nearby')
        break
      }

      const botPos = bot.entity.position
      positions.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b))

      for (const pos of positions) {
        if (mined >= quantity) break

        const reached = await navigateTo(bot, pos)
        if (!reached) continue

        // Equip shovel if available
        await equipBestToolOfType(bot, 'shovel')

        const block = bot.blockAt(pos)
        if (block && block.name === 'sand') {
          const dug = await digBlock(bot, block)
          if (dug) {
            mined++
            await collectDrops(bot, pos, 1500)
          }
        }
      }
    }

    const endCount = countInventoryItem(bot, 'sand')
    const actualMined = endCount - startCount

    return {
      success: actualMined > 0,
      collected: actualMined,
      requested: quantity,
      itemName: 'sand',
      message: actualMined >= quantity
        ? `Collected ${actualMined} sand`
        : `Could only collect ${actualMined}/${quantity} sand`,
    }
  },
})

// 5. collect_gravel
skillRegistry.register({
  id: 'collect_gravel',
  name: 'Collect Gravel',
  category: 'resource_gathering',
  description: 'Dig gravel blocks. Uses a shovel if available for faster mining.',
  arguments: {
    quantity: { type: 'number', default: 16, min: 1, max: 256 },
  },
  requires: [],
  permissions: ['*'],
  timeout: 120_000,
  execute: async (bot, args, context) => {
    const quantity = args.quantity || 16
    const mcData = context.mcData

    const startCount = countInventoryItem(bot, 'gravel')
    let mined = 0

    for (let attempt = 0; attempt < 15 && mined < quantity; attempt++) {
      const positions = findBlocks(bot, mcData, 'gravel', 64, 32)
      if (positions.length === 0) {
        log.info('No gravel found nearby')
        break
      }

      const botPos = bot.entity.position
      positions.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b))

      for (const pos of positions) {
        if (mined >= quantity) break

        const reached = await navigateTo(bot, pos)
        if (!reached) continue

        await equipBestToolOfType(bot, 'shovel')

        const block = bot.blockAt(pos)
        if (block && block.name === 'gravel') {
          const dug = await digBlock(bot, block)
          if (dug) {
            mined++
            await collectDrops(bot, pos, 1500)
          }
        }
      }
    }

    const endCount = countInventoryItem(bot, 'gravel')
    const actualMined = endCount - startCount

    return {
      success: actualMined > 0,
      collected: actualMined,
      requested: quantity,
      itemName: 'gravel',
      message: actualMined >= quantity
        ? `Collected ${actualMined} gravel`
        : `Could only collect ${actualMined}/${quantity} gravel`,
    }
  },
})

// 6. collect_dirt
skillRegistry.register({
  id: 'collect_dirt',
  name: 'Collect Dirt',
  category: 'resource_gathering',
  description: 'Dig dirt blocks. Uses a shovel if available for faster mining.',
  arguments: {
    quantity: { type: 'number', default: 16, min: 1, max: 256 },
  },
  requires: [],
  permissions: ['*'],
  timeout: 120_000,
  execute: async (bot, args, context) => {
    const quantity = args.quantity || 16
    const mcData = context.mcData

    const startCount = countInventoryItem(bot, 'dirt')
    let mined = 0

    for (let attempt = 0; attempt < 15 && mined < quantity; attempt++) {
      // Search for both dirt and grass_block (drops dirt)
      let positions = findBlocks(bot, mcData, 'dirt', 64, 32)
      const grassPositions = findBlocks(bot, mcData, 'grass_block', 64, 16)
      positions = positions.concat(grassPositions)

      if (positions.length === 0) {
        log.info('No dirt found nearby')
        break
      }

      const botPos = bot.entity.position
      positions.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b))

      for (const pos of positions) {
        if (mined >= quantity) break

        const reached = await navigateTo(bot, pos)
        if (!reached) continue

        await equipBestToolOfType(bot, 'shovel')

        const block = bot.blockAt(pos)
        if (block && (block.name === 'dirt' || block.name === 'grass_block')) {
          const dug = await digBlock(bot, block)
          if (dug) {
            mined++
            await collectDrops(bot, pos, 1500)
          }
        }
      }
    }

    const endCount = countInventoryItem(bot, 'dirt')
    const actualMined = endCount - startCount

    return {
      success: actualMined > 0,
      collected: actualMined,
      requested: quantity,
      itemName: 'dirt',
      message: actualMined >= quantity
        ? `Collected ${actualMined} dirt`
        : `Could only collect ${actualMined}/${quantity} dirt`,
    }
  },
})

// 7. collect_clay
skillRegistry.register({
  id: 'collect_clay',
  name: 'Collect Clay',
  category: 'resource_gathering',
  description: 'Dig clay blocks, typically found near water. Uses a shovel if available.',
  arguments: {
    quantity: { type: 'number', default: 16, min: 1, max: 256 },
  },
  requires: [],
  permissions: ['*'],
  timeout: 120_000,
  execute: async (bot, args, context) => {
    const quantity = args.quantity || 16
    const mcData = context.mcData

    // Clay blocks drop 4 clay balls each
    const startCount = countInventoryItem(bot, 'clay_ball')
    let mined = 0

    for (let attempt = 0; attempt < 15 && mined < quantity; attempt++) {
      const positions = findBlocks(bot, mcData, 'clay', 64, 32)
      if (positions.length === 0) {
        log.info('No clay found nearby')
        break
      }

      const botPos = bot.entity.position
      positions.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b))

      for (const pos of positions) {
        if (mined >= quantity) break

        const reached = await navigateTo(bot, pos)
        if (!reached) continue

        await equipBestToolOfType(bot, 'shovel')

        const block = bot.blockAt(pos)
        if (block && block.name === 'clay') {
          const dug = await digBlock(bot, block)
          if (dug) {
            mined++
            await collectDrops(bot, pos, 2000)
          }
        }
      }
    }

    const endCount = countInventoryItem(bot, 'clay_ball')
    const actualMined = endCount - startCount

    return {
      success: actualMined > 0,
      collected: actualMined,
      blocksMined: mined,
      requested: quantity,
      itemName: 'clay_ball',
      message: mined >= quantity
        ? `Mined ${mined} clay blocks (got ${actualMined} clay balls)`
        : `Could only mine ${mined}/${quantity} clay blocks (got ${actualMined} clay balls)`,
    }
  },
})

// 8. mine_vein
skillRegistry.register({
  id: 'mine_vein',
  name: 'Mine Vein',
  category: 'resource_gathering',
  description: 'Mine an entire ore vein starting from a known block position. Uses BFS to find and mine all connected blocks of the same type.',
  arguments: {
    position: { type: 'object', properties: { x: 'number', y: 'number', z: 'number' }, required: true },
    oreType: { type: 'string', required: true },
  },
  requires: [],
  permissions: ['*'],
  timeout: 120_000,
  execute: async (bot, args, context) => {
    const { position, oreType } = args
    if (!position || !oreType) {
      return { success: false, message: 'position and oreType are required' }
    }

    const startPos = new Vec3(position.x, position.y, position.z)
    const mcData = context.mcData
    const blockType = mcData.blocksByName[oreType]
    if (!blockType) {
      return { success: false, message: `Unknown block type: ${oreType}` }
    }

    // BFS to find all connected blocks of the same type
    const visited = new Set()
    const queue = [startPos]
    const veinBlocks = []

    const posKey = (p) => `${p.x},${p.y},${p.z}`

    while (queue.length > 0) {
      const pos = queue.shift()
      const key = posKey(pos)
      if (visited.has(key)) continue
      visited.add(key)

      const block = bot.blockAt(pos)
      if (!block || block.name !== oreType) continue

      veinBlocks.push(pos.clone())

      // Check all 6 adjacent faces
      const offsets = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1],
      ]
      for (const [dx, dy, dz] of offsets) {
        const neighbor = pos.offset(dx, dy, dz)
        if (!visited.has(posKey(neighbor))) {
          queue.push(neighbor)
        }
      }
    }

    if (veinBlocks.length === 0) {
      return { success: false, message: `No ${oreType} found at position`, mined: 0 }
    }

    log.info({ oreType, veinSize: veinBlocks.length }, 'Found ore vein')

    // Mine all blocks in the vein
    let mined = 0
    for (const pos of veinBlocks) {
      const reached = await navigateTo(bot, pos, 10000)
      if (!reached) continue

      await equipBestToolForBlock(bot, oreType)

      const block = bot.blockAt(pos)
      if (block && block.name === oreType) {
        const dug = await digBlock(bot, block)
        if (dug) {
          mined++
          await collectDrops(bot, pos, 1500)
        }
      }
    }

    return {
      success: mined > 0,
      mined,
      veinSize: veinBlocks.length,
      oreType,
      message: `Mined ${mined}/${veinBlocks.length} blocks of ${oreType}`,
    }
  },
})

// 9. strip_mine
skillRegistry.register({
  id: 'strip_mine',
  name: 'Strip Mine',
  category: 'resource_gathering',
  description: 'Create a 1x2 strip mine tunnel in a specified direction. Checks walls for exposed ores and mines them. Places torches every 8 blocks if available.',
  arguments: {
    direction: { type: 'string', enum: ['north', 'south', 'east', 'west'], required: true },
    length: { type: 'number', default: 32, min: 4, max: 128 },
    yLevel: { type: 'number', default: -59, min: -64, max: 320 },
  },
  requires: [],
  permissions: ['*'],
  timeout: 300_000,
  execute: async (bot, args, context) => {
    const direction = args.direction
    const length = args.length || 32
    const mcData = context.mcData

    // Direction vectors
    const dirVectors = {
      north: new Vec3(0, 0, -1),
      south: new Vec3(0, 0, 1),
      east: new Vec3(1, 0, 0),
      west: new Vec3(-1, 0, 0),
    }
    const dir = dirVectors[direction]
    if (!dir) {
      return { success: false, message: `Invalid direction: ${direction}` }
    }

    // Perpendicular directions for wall checks
    const perpDirs = direction === 'north' || direction === 'south'
      ? [new Vec3(1, 0, 0), new Vec3(-1, 0, 0)]
      : [new Vec3(0, 0, 1), new Vec3(0, 0, -1)]

    // Ore names to look for on walls
    const oreNames = new Set([
      'coal_ore', 'deepslate_coal_ore',
      'iron_ore', 'deepslate_iron_ore',
      'copper_ore', 'deepslate_copper_ore',
      'gold_ore', 'deepslate_gold_ore',
      'redstone_ore', 'deepslate_redstone_ore',
      'lapis_ore', 'deepslate_lapis_ore',
      'diamond_ore', 'deepslate_diamond_ore',
      'emerald_ore', 'deepslate_emerald_ore',
      'nether_quartz_ore', 'nether_gold_ore',
    ])

    const startPos = bot.entity.position.floored()
    const oresFound = []
    let blocksDug = 0

    // Check for pickaxe
    const equipped = await equipBestToolOfType(bot, 'pickaxe')
    if (!equipped) {
      return { success: false, message: 'No pickaxe available for strip mining' }
    }

    for (let i = 0; i < length; i++) {
      const lowerPos = startPos.plus(dir.scaled(i + 1))
      const upperPos = lowerPos.offset(0, 1, 0)

      // Dig the lower block
      await equipBestToolOfType(bot, 'pickaxe')
      const lowerBlock = bot.blockAt(lowerPos)
      if (lowerBlock && lowerBlock.name !== 'air') {
        const reached = await navigateTo(bot, lowerPos, 8000)
        if (!reached) {
          // Try digging from current position if close enough
          if (bot.entity.position.distanceTo(lowerPos) > 5) continue
        }
        await equipBestToolForBlock(bot, lowerBlock.name)
        if (await digBlock(bot, lowerBlock)) blocksDug++
      }

      // Dig the upper block
      const upperBlock = bot.blockAt(upperPos)
      if (upperBlock && upperBlock.name !== 'air') {
        await equipBestToolForBlock(bot, upperBlock.name)
        if (await digBlock(bot, upperBlock)) blocksDug++
      }

      // Walk into the tunnel
      await navigateTo(bot, lowerPos, 5000)

      // Check walls for ores (both sides, both heights)
      for (const perpDir of perpDirs) {
        for (let dy = 0; dy <= 1; dy++) {
          const wallPos = lowerPos.plus(perpDir).offset(0, dy, 0)
          const wallBlock = bot.blockAt(wallPos)
          if (wallBlock && oreNames.has(wallBlock.name)) {
            log.info({ ore: wallBlock.name, pos: wallPos }, 'Found ore in wall')
            oresFound.push({ name: wallBlock.name, position: { x: wallPos.x, y: wallPos.y, z: wallPos.z } })

            // Mine the ore
            await equipBestToolOfType(bot, 'pickaxe')
            if (await digBlock(bot, wallBlock)) {
              await collectDrops(bot, wallPos, 1500)
            }
          }
        }
      }

      // Also check floor and ceiling for ores
      for (const dy of [-1, 2]) {
        const checkPos = lowerPos.offset(0, dy, 0)
        const checkBlock = bot.blockAt(checkPos)
        if (checkBlock && oreNames.has(checkBlock.name)) {
          oresFound.push({ name: checkBlock.name, position: { x: checkPos.x, y: checkPos.y, z: checkPos.z } })
          await equipBestToolOfType(bot, 'pickaxe')
          if (await digBlock(bot, checkBlock)) {
            await collectDrops(bot, checkPos, 1500)
          }
        }
      }

      // Place torch every 8 blocks
      if (i > 0 && i % 8 === 0) {
        const torchItem = bot.inventory.items().find(item => item.name === 'torch')
        if (torchItem) {
          try {
            // Place torch on the wall behind us
            const floorBlock = bot.blockAt(lowerPos.offset(0, -1, 0))
            if (floorBlock && floorBlock.name !== 'air') {
              await bot.equip(torchItem, 'hand')
              await bot.placeBlock(floorBlock, new Vec3(0, 1, 0))
            }
          } catch (err) {
            log.debug({ err: err.message }, 'Could not place torch')
          }
        }
      }
    }

    return {
      success: blocksDug > 0,
      blocksDug,
      tunnelLength: length,
      direction,
      oresFound,
      oresCount: oresFound.length,
      message: `Dug ${length}-block tunnel ${direction}. Found ${oresFound.length} ore blocks.`,
    }
  },
})

// 10. branch_mine
skillRegistry.register({
  id: 'branch_mine',
  name: 'Branch Mine',
  category: 'resource_gathering',
  description: 'Create a branch mining pattern with a main tunnel and side branches. Efficient for finding ores at specific Y levels.',
  arguments: {
    center: { type: 'object', properties: { x: 'number', y: 'number', z: 'number' } },
    branchLength: { type: 'number', default: 16, min: 4, max: 64 },
    branchSpacing: { type: 'number', default: 3, min: 2, max: 8 },
    branchCount: { type: 'number', default: 4, min: 1, max: 16 },
  },
  requires: [],
  permissions: ['*'],
  timeout: 600_000,
  execute: async (bot, args, context) => {
    const branchLength = args.branchLength || 16
    const branchSpacing = args.branchSpacing || 3
    const branchCount = args.branchCount || 4
    const mcData = context.mcData

    // Check for pickaxe
    const equipped = await equipBestToolOfType(bot, 'pickaxe')
    if (!equipped) {
      return { success: false, message: 'No pickaxe available for branch mining' }
    }

    // Determine start position (use center or current position)
    const startPos = args.center
      ? new Vec3(args.center.x, args.center.y, args.center.z)
      : bot.entity.position.floored()

    // Navigate to start if center was specified
    if (args.center) {
      await navigateTo(bot, startPos, 30000)
    }

    // Ore names to watch for
    const oreNames = new Set([
      'coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore',
      'copper_ore', 'deepslate_copper_ore', 'gold_ore', 'deepslate_gold_ore',
      'redstone_ore', 'deepslate_redstone_ore', 'lapis_ore', 'deepslate_lapis_ore',
      'diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore',
    ])

    const allOresFound = []
    let totalBlocksDug = 0
    let branchesMined = 0

    // Main tunnel goes north (negative Z)
    const mainDir = new Vec3(0, 0, -1)
    // Branches go east and west
    const branchDirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0)]

    const mainTunnelLength = (branchCount * branchSpacing) + 1

    // Dig main tunnel
    for (let i = 0; i < mainTunnelLength; i++) {
      const lowerPos = startPos.plus(mainDir.scaled(i + 1))
      const upperPos = lowerPos.offset(0, 1, 0)

      await equipBestToolOfType(bot, 'pickaxe')

      const lowerBlock = bot.blockAt(lowerPos)
      if (lowerBlock && lowerBlock.name !== 'air') {
        await equipBestToolForBlock(bot, lowerBlock.name)
        if (await digBlock(bot, lowerBlock)) totalBlocksDug++
      }

      const upperBlock = bot.blockAt(upperPos)
      if (upperBlock && upperBlock.name !== 'air') {
        await equipBestToolForBlock(bot, upperBlock.name)
        if (await digBlock(bot, upperBlock)) totalBlocksDug++
      }

      await navigateTo(bot, lowerPos, 5000)

      // At branch intervals, dig branches to both sides
      if (i > 0 && i % branchSpacing === 0 && branchesMined < branchCount * 2) {
        for (const branchDir of branchDirs) {
          const branchStart = lowerPos.clone()

          for (let j = 0; j < branchLength; j++) {
            const bLowerPos = branchStart.plus(branchDir.scaled(j + 1))
            const bUpperPos = bLowerPos.offset(0, 1, 0)

            await equipBestToolOfType(bot, 'pickaxe')

            const bLowerBlock = bot.blockAt(bLowerPos)
            if (bLowerBlock && bLowerBlock.name !== 'air') {
              await equipBestToolForBlock(bot, bLowerBlock.name)
              if (await digBlock(bot, bLowerBlock)) totalBlocksDug++
            }

            const bUpperBlock = bot.blockAt(bUpperPos)
            if (bUpperBlock && bUpperBlock.name !== 'air') {
              await equipBestToolForBlock(bot, bUpperBlock.name)
              if (await digBlock(bot, bUpperBlock)) totalBlocksDug++
            }

            await navigateTo(bot, bLowerPos, 5000)

            // Check perpendicular walls for ores (along main tunnel direction)
            for (const wallDir of [mainDir, mainDir.scaled(-1)]) {
              for (let dy = 0; dy <= 1; dy++) {
                const wallPos = bLowerPos.plus(wallDir).offset(0, dy, 0)
                const wallBlock = bot.blockAt(wallPos)
                if (wallBlock && oreNames.has(wallBlock.name)) {
                  allOresFound.push({ name: wallBlock.name, position: { x: wallPos.x, y: wallPos.y, z: wallPos.z } })
                  await equipBestToolOfType(bot, 'pickaxe')
                  if (await digBlock(bot, wallBlock)) {
                    await collectDrops(bot, wallPos, 1500)
                  }
                }
              }
            }

            // Check floor and ceiling for ores
            for (const dy of [-1, 2]) {
              const checkPos = bLowerPos.offset(0, dy, 0)
              const checkBlock = bot.blockAt(checkPos)
              if (checkBlock && oreNames.has(checkBlock.name)) {
                allOresFound.push({ name: checkBlock.name, position: { x: checkPos.x, y: checkPos.y, z: checkPos.z } })
                await equipBestToolOfType(bot, 'pickaxe')
                if (await digBlock(bot, checkBlock)) {
                  await collectDrops(bot, checkPos, 1500)
                }
              }
            }

            // Place torch every 8 blocks in branch
            if (j > 0 && j % 8 === 0) {
              const torchItem = bot.inventory.items().find(item => item.name === 'torch')
              if (torchItem) {
                try {
                  const floorBlock = bot.blockAt(bLowerPos.offset(0, -1, 0))
                  if (floorBlock && floorBlock.name !== 'air') {
                    await bot.equip(torchItem, 'hand')
                    await bot.placeBlock(floorBlock, new Vec3(0, 1, 0))
                  }
                } catch {
                  // Torch placement is best-effort
                }
              }
            }
          }

          branchesMined++

          // Walk back to main tunnel junction
          await navigateTo(bot, branchStart, 10000)
        }
      }
    }

    return {
      success: totalBlocksDug > 0,
      totalBlocksDug,
      branchesMined,
      branchLength,
      branchSpacing,
      oresFound: allOresFound,
      oresCount: allOresFound.length,
      message: `Branch mine complete. Dug ${branchesMined} branches of length ${branchLength}. Found ${allOresFound.length} ore blocks.`,
    }
  },
})

// 11. check_tool_for_block
skillRegistry.register({
  id: 'check_tool_for_block',
  name: 'Check Tool For Block',
  category: 'resource_gathering',
  description: 'Check what tool type and minimum tier is needed to mine a specific block.',
  arguments: {
    blockName: { type: 'string', required: true },
  },
  requires: [],
  permissions: ['*'],
  timeout: 5000,
  execute: async (bot, args, context) => {
    const blockName = args.blockName
    if (!blockName) {
      return { success: false, message: 'blockName is required' }
    }

    const mcData = context.mcData
    const blockType = mcData.blocksByName[blockName]
    if (!blockType) {
      return { success: false, message: `Unknown block: ${blockName}` }
    }

    const toolType = getToolTypeForBlock(blockName)
    let requiredTier = null

    // Determine minimum tier based on harvest level
    if (toolType === 'pickaxe') {
      // Check if it's an ore with specific requirements
      for (const [ore, tool] of Object.entries(ORE_TOOL_REQUIREMENTS)) {
        if (blockName.includes(ore)) {
          requiredTier = tool
          break
        }
      }
      if (!requiredTier) {
        // Default stone/cobblestone needs wooden_pickaxe
        requiredTier = 'wooden_pickaxe'
      }
    } else if (toolType) {
      requiredTier = `wooden_${toolType}`
    }

    // Check what the bot currently has
    const currentTool = toolType ? await equipBestToolOfType(bot, toolType) : null

    return {
      success: true,
      blockName,
      toolType: toolType || 'any',
      requiredTier: requiredTier || 'none',
      hardness: blockType.hardness,
      hasSuitableTool: !!currentTool,
      currentTool: currentTool?.name || 'none',
      canHarvest: !toolType || !!currentTool,
      message: toolType
        ? `${blockName} requires ${requiredTier || `a ${toolType}`}. You have: ${currentTool?.name || 'none'}`
        : `${blockName} can be mined with any tool or bare hands`,
    }
  },
})

// 12. equip_best_tool
skillRegistry.register({
  id: 'equip_best_tool',
  name: 'Equip Best Tool',
  category: 'resource_gathering',
  description: 'Equip the best available tool from inventory for mining a specific block type. Checks pickaxe for stone/ore, axe for wood, shovel for dirt/sand/gravel.',
  arguments: {
    blockName: { type: 'string', required: true },
  },
  requires: [],
  permissions: ['*'],
  timeout: 5000,
  execute: async (bot, args, context) => {
    const blockName = args.blockName
    if (!blockName) {
      return { success: false, message: 'blockName is required' }
    }

    const toolType = getToolTypeForBlock(blockName)
    if (!toolType) {
      return {
        success: true,
        equipped: null,
        message: `${blockName} does not require a specific tool`,
      }
    }

    const equipped = await equipBestToolOfType(bot, toolType)

    if (equipped) {
      return {
        success: true,
        equipped: equipped.name,
        toolType,
        message: `Equipped ${equipped.name} for mining ${blockName}`,
      }
    }

    return {
      success: false,
      toolType,
      message: `No ${toolType} found in inventory for mining ${blockName}`,
    }
  },
})

log.info(`Registered ${skillRegistry.getByCategory('resource_gathering').length} resource gathering skills`)

export default {}
