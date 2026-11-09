/**
 * Inventory and Storage skills module for minecraft-ai-squad
 *
 * Implements inventory inspection, item counting, chest storage, retrieval,
 * organization, missing materials check, dropping items, and protecting valuables.
 */

import { skillRegistry } from './registry.js'
import { logger } from '../utils/logger.js'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

const { goals: { GoalGetToBlock, GoalNear } } = pathfinderPackage
const log = logger.child({ component: 'InventorySkills' })

const VALUABLE_ITEMS = new Set([
  'diamond', 'diamond_block', 'diamond_pickaxe', 'diamond_sword', 'diamond_axe',
  'diamond_chestplate', 'diamond_helmet', 'diamond_leggings', 'diamond_boots',
  'ancient_debris', 'netherite_ingot', 'netherite_scrap', 'emerald', 'enchanted_golden_apple',
])

// ─── inspect_inventory ───────────────────────────────────────────────────────
skillRegistry.register({
  id: 'inspect_inventory',
  name: 'Inspect Inventory',
  category: 'inventory',
  description: 'List all items currently in inventory with slot, count, and durability',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute(bot) {
    const items = bot.inventory.items().map(i => ({
      name: i.name,
      count: i.count,
      slot: i.slot,
      durabilityUsed: i.durabilityUsed || 0,
      maxDurability: i.maxDurability || 0,
    }))

    const totalSlots = 36
    const occupiedSlots = bot.inventory.items().length
    const emptySlots = totalSlots - occupiedSlots

    return {
      success: true,
      items,
      totalItems: items.reduce((acc, i) => acc + i.count, 0),
      emptySlots,
      isFull: emptySlots === 0,
    }
  },
})

// ─── count_item ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'count_item',
  name: 'Count Specific Item',
  category: 'inventory',
  description: 'Count how many of a specific item the bot carries',
  arguments: {
    itemName: { type: 'string', required: true, description: 'Item name' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute(bot, args) {
    const count = bot.inventory.items()
      .filter(i => i.name === args.itemName)
      .reduce((acc, i) => acc + i.count, 0)

    return {
      success: true,
      itemName: args.itemName,
      count,
    }
  },
})

// ─── find_missing_materials ──────────────────────────────────────────────────
skillRegistry.register({
  id: 'find_missing_materials',
  name: 'Find Missing Materials',
  category: 'inventory',
  description: 'Compare required materials against current inventory and return missing list',
  arguments: {
    requirements: { type: 'object', required: true, description: 'Key-value map of itemName: count' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute(bot, args) {
    const requirements = args.requirements || {}
    const missing = {}
    const available = {}
    let allPresent = true

    for (const [name, reqCount] of Object.entries(requirements)) {
      const current = bot.inventory.items()
        .filter(i => i.name === name)
        .reduce((acc, i) => acc + i.count, 0)

      available[name] = current
      if (current < reqCount) {
        missing[name] = reqCount - current
        allPresent = false
      }
    }

    return {
      success: true,
      allPresent,
      missing,
      available,
    }
  },
})

// ─── find_chests ─────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'find_chests',
  name: 'Find Nearby Chests',
  category: 'inventory',
  description: 'Search for chest and barrel blocks within radius',
  arguments: {
    maxDistance: { type: 'number', required: false, default: 32, description: 'Search distance' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 20000,

  async execute(bot, args, context) {
    const maxDist = args.maxDistance ?? 32
    const chestDef = context.mcData.blocksByName['chest']
    const barrelDef = context.mcData.blocksByName['barrel']
    const trappedDef = context.mcData.blocksByName['trapped_chest']

    const matches = []
    for (const def of [chestDef, barrelDef, trappedDef]) {
      if (!def) continue
      const blocks = bot.findBlocks({ matching: def.id, maxDistance: maxDist, count: 10 })
      for (const p of blocks) {
        matches.push({
          type: def.name,
          position: { x: p.x, y: p.y, z: p.z },
          distance: Number(bot.entity.position.distanceTo(p).toFixed(1)),
        })
      }
    }

    matches.sort((a, b) => a.distance - b.distance)

    return {
      success: true,
      found: matches.length > 0,
      chests: matches,
    }
  },
})

// ─── store_items ─────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'store_items',
  name: 'Store Items in Chest',
  category: 'inventory',
  description: 'Open a target chest and deposit specified items or all non-essential items',
  arguments: {
    chestPosition: { type: 'object', required: false, description: '{x, y, z} chest position' },
    itemNames: { type: 'array', required: false, description: 'Items to store (or empty for non-essentials)' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args, context) {
    let chestBlock = null

    if (args.chestPosition) {
      const p = new Vec3(args.chestPosition.x, args.chestPosition.y, args.chestPosition.z)
      chestBlock = bot.blockAt(p)
    } else {
      const chestDef = context.mcData.blocksByName['chest'] || context.mcData.blocksByName['barrel']
      if (chestDef) {
        chestBlock = bot.findBlock({ matching: chestDef.id, maxDistance: 16 })
      }
    }

    if (!chestBlock) {
      return { success: false, error: 'Target chest not found' }
    }

    bot.pathfinder.setGoal(new GoalGetToBlock(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z))
    await new Promise(r => setTimeout(r, 2000))

    const chest = await bot.openContainer(chestBlock)
    try {
      const itemsToDeposit = bot.inventory.items().filter(item => {
        if (args.itemNames && args.itemNames.length > 0) {
          return args.itemNames.includes(item.name)
        }
        // Exclude tools, weapons, armor, and primary food
        const isTool = item.name.endsWith('_sword') || item.name.endsWith('_pickaxe') || item.name.endsWith('_axe')
        const isArmor = item.name.endsWith('_helmet') || item.name.endsWith('_chestplate') || item.name.endsWith('_leggings') || item.name.endsWith('_boots')
        const isFood = ['cooked_beef', 'bread'].includes(item.name)
        return !isTool && !isArmor && !isFood
      })

      let depositedCount = 0
      for (const item of itemsToDeposit) {
        try {
          await chest.deposit(item.type, null, item.count)
          depositedCount += item.count
        } catch {
          // Chest might be full
          break
        }
      }

      chest.close()
      return {
        success: true,
        depositedCount,
      }
    } catch (err) {
      chest.close()
      return { success: false, error: err.message }
    }
  },
})

// ─── retrieve_items ──────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'retrieve_items',
  name: 'Retrieve Items from Chest',
  category: 'inventory',
  description: 'Open a chest and withdraw specified items',
  arguments: {
    itemName: { type: 'string', required: true, description: 'Item name to retrieve' },
    quantity: { type: 'number', required: false, default: 1, description: 'Quantity' },
    chestPosition: { type: 'object', required: false, description: '{x, y, z} chest position' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args, context) {
    let chestBlock = null

    if (args.chestPosition) {
      const p = new Vec3(args.chestPosition.x, args.chestPosition.y, args.chestPosition.z)
      chestBlock = bot.blockAt(p)
    } else {
      const chestDef = context.mcData.blocksByName['chest'] || context.mcData.blocksByName['barrel']
      if (chestDef) {
        chestBlock = bot.findBlock({ matching: chestDef.id, maxDistance: 16 })
      }
    }

    if (!chestBlock) return { success: false, error: 'No chest found' }

    bot.pathfinder.setGoal(new GoalGetToBlock(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z))
    await new Promise(r => setTimeout(r, 2000))

    const chest = await bot.openContainer(chestBlock)
    try {
      const itemDef = context.mcData.itemsByName[args.itemName] || context.mcData.blocksByName[args.itemName]
      if (!itemDef) {
        chest.close()
        return { success: false, error: `Unknown item ${args.itemName}` }
      }

      const withdrawCount = args.quantity ?? 1
      await chest.withdraw(itemDef.id, null, withdrawCount)
      chest.close()

      return {
        success: true,
        retrieved: args.itemName,
        quantity: withdrawCount,
      }
    } catch (err) {
      chest.close()
      return { success: false, error: err.message }
    }
  },
})

// ─── drop_items ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'drop_items',
  name: 'Drop Items from Inventory',
  category: 'inventory',
  description: 'Toss specified items out of inventory onto ground (protects valuables)',
  arguments: {
    itemName: { type: 'string', required: true, description: 'Item name to toss' },
    quantity: { type: 'number', required: false, description: 'Quantity (or all if omitted)' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 15000,

  async execute(bot, args) {
    if (VALUABLE_ITEMS.has(args.itemName)) {
      return { success: false, error: `Safety block: Refusing to drop valuable item '${args.itemName}'` }
    }

    const item = bot.inventory.items().find(i => i.name === args.itemName)
    if (!item) {
      return { success: false, error: `Item '${args.itemName}' not found in inventory` }
    }

    const countToToss = args.quantity ? Math.min(item.count, args.quantity) : item.count
    await bot.toss(item.type, null, countToToss)

    return {
      success: true,
      tossed: args.itemName,
      count: countToToss,
    }
  },
})

// ─── track_resources ────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'track_resources',
  name: 'Track and Categorize Resources',
  category: 'inventory',
  description: 'Summarize all inventory resources grouped by category (tools, blocks, minerals, food)',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute(bot) {
    const summary = {
      tools: [],
      minerals: [],
      blocks: [],
      food: [],
      misc: [],
    }

    for (const item of bot.inventory.items()) {
      if (item.name.endsWith('_sword') || item.name.endsWith('_pickaxe') || item.name.endsWith('_axe') || item.name.endsWith('_shovel')) {
        summary.tools.push({ name: item.name, count: item.count })
      } else if (item.name.includes('ore') || item.name.includes('ingot') || item.name.includes('diamond') || item.name === 'coal' || item.name === 'raw_iron') {
        summary.minerals.push({ name: item.name, count: item.count })
      } else if (item.name.includes('planks') || item.name.includes('stone') || item.name.includes('dirt') || item.name.includes('cobble')) {
        summary.blocks.push({ name: item.name, count: item.count })
      } else if (['cooked_beef', 'bread', 'apple', 'carrot'].includes(item.name)) {
        summary.food.push({ name: item.name, count: item.count })
      } else {
        summary.misc.push({ name: item.name, count: item.count })
      }
    }

    return {
      success: true,
      summary,
    }
  },
})

