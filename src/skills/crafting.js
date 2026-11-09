/**
 * Crafting and Equipment skills module for minecraft-ai-squad
 *
 * Implements recipe calculation, crafting tools, tables, furnaces, chests,
 * armor, shields, torches, doors, smelting ores, and equipping tools/weapons.
 */

import { skillRegistry } from './registry.js'
import { logger } from '../utils/logger.js'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

const { goals: { GoalGetToBlock, GoalNear } } = pathfinderPackage
const log = logger.child({ component: 'CraftingSkills' })

// ─── Helper: Ensure or Place Crafting Table ──────────────────────────────────
async function getOrPlaceCraftingTable(bot, mcData) {
  const tableDef = mcData.blocksByName['crafting_table']
  if (!tableDef) return null

  // 1. Look for nearby crafting table
  let tablePos = bot.findBlock({ matching: tableDef.id, maxDistance: 16 })
  if (tablePos) return tablePos

  // 2. Check if we have one in inventory
  let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table')
  if (!tableItem) {
    // Auto-craft table if we have planks or logs
    let planks = bot.inventory.items().find(i => i.name.endsWith('_planks') && i.count >= 4)
    if (!planks) {
      const logs = bot.inventory.items().find(i => i.name.endsWith('_log') || i.name.endsWith('_wood'))
      if (logs) {
        const plankName = logs.name.replace(/_log|_wood/, '_planks')
        const pDef = mcData.itemsByName[plankName]
        if (pDef) {
          const pRec = bot.recipesFor(pDef.id, null, 1, null)
          if (pRec?.[0]) await bot.craft(pRec[0], 1, null)
        }
      }
    }
    const tDef = mcData.itemsByName['crafting_table']
    if (tDef) {
      const tRec = bot.recipesFor(tDef.id, null, 1, null)
      if (tRec?.[0]) await bot.craft(tRec[0], 1, null)
    }
    tableItem = bot.inventory.items().find(i => i.name === 'crafting_table')
  }

  if (tableItem) {
    const pos = bot.entity.position
    // Try adjacent block positions to place crafting table
    const offsets = [
      new Vec3(1, -1, 0), new Vec3(-1, -1, 0),
      new Vec3(0, -1, 1), new Vec3(0, -1, -1),
    ]
    for (const off of offsets) {
      const ground = bot.blockAt(pos.plus(off))
      const spaceAbove = bot.blockAt(pos.plus(off).offset(0, 1, 0))
      if (ground && ground.boundingBox === 'block' && spaceAbove && spaceAbove.name === 'air') {
        try {
          await bot.equip(tableItem, 'hand')
          await bot.placeBlock(ground, new Vec3(0, 1, 0))
          await new Promise(r => setTimeout(r, 600))
          return bot.findBlock({ matching: tableDef.id, maxDistance: 6 })
        } catch {
          // try next offset
        }
      }
    }
  }

  return null
}

skillRegistry.register({
  id: 'place_crafting_table',
  name: 'Place Crafting Table',
  category: 'crafting',
  description: 'Place an available crafting table on verified solid ground nearby',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 30000,
  async execute(bot, args, context) {
    const tableDef = context.mcData.blocksByName.crafting_table
    const existing = bot.findBlock({ matching: tableDef.id, maxDistance: 16 })
    if (existing) return { success: true, verified: true, position: existing.position, existing: true }
    const table = bot.inventory.items().find(item => item.name === 'crafting_table')
    if (!table) return { success: false, error: 'No crafting table available in inventory' }
    const origin = bot.entity.position.floored()
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          const ground = bot.blockAt(origin.offset(dx, dy, dz))
          const space = bot.blockAt(origin.offset(dx, dy + 1, dz))
          if (!ground || ground.boundingBox !== 'block' || !space || space.name !== 'air') continue
          try {
            await bot.equip(table, 'hand')
            await bot.placeBlock(ground, new Vec3(0, 1, 0))
            await new Promise(resolve => setTimeout(resolve, 500))
            const placed = bot.findBlock({ matching: tableDef.id, maxDistance: 16 })
            if (placed) return { success: true, verified: true, position: placed.position }
          } catch {
            // Try the next reachable solid position.
          }
        }
      }
    }
    return { success: false, error: 'Could not place crafting table on nearby solid ground' }
  },
})

// ─── craft_planks ────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_planks',
  name: 'Craft Wooden Planks',
  category: 'crafting',
  description: 'Convert logs into wood planks (done in 2x2 player inventory grid)',
  arguments: {
    logType: { type: 'string', required: false, default: 'oak_log', description: 'Log type' },
    count: { type: 'number', required: false, default: 4, description: 'Number of logs to craft' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 30000,

  async execute(bot, args, context) {
    const logItem = bot.inventory.items().find(i => i.name.endsWith('_log') || i.name.endsWith('_wood'))
    if (!logItem) {
      return { success: false, error: 'No logs found in inventory' }
    }

    const plankName = logItem.name.replace(/_log|_wood/, '_planks')
    const plankDef = context.mcData.itemsByName[plankName]
    if (!plankDef) return { success: false, error: `Item definition for ${plankName} not found` }

    const recipes = bot.recipesFor(plankDef.id, null, 1, null)
    if (!recipes || recipes.length === 0) {
      return { success: false, error: `No recipe available for ${plankName}` }
    }

    const logsToUse = Math.min(logItem.count, args.count ?? 4)
    await bot.craft(recipes[0], logsToUse, null)

    return {
      success: true,
      crafted: plankName,
      logsUsed: logsToUse,
      planksProduced: logsToUse * 4,
    }
  },
})

// ─── craft_sticks ────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_sticks',
  name: 'Craft Sticks',
  category: 'crafting',
  description: 'Convert wooden planks into sticks (done in 2x2 player inventory)',
  arguments: {
    count: { type: 'number', required: false, default: 4, description: 'Stick recipe batches (x4 each)' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 20000,

  async execute(bot, args, context) {
    const stickDef = context.mcData.itemsByName['stick']
    if (!stickDef) return { success: false, error: 'Stick definition not found' }

    const recipes = bot.recipesFor(stickDef.id, null, 1, null)
    if (!recipes || recipes.length === 0) {
      return { success: false, error: 'Cannot craft sticks: missing planks' }
    }

    const batches = args.count ?? 2
    await bot.craft(recipes[0], batches, null)

    return {
      success: true,
      crafted: 'stick',
      produced: batches * 4,
    }
  },
})

// ─── craft_crafting_table ────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_crafting_table',
  name: 'Craft Crafting Table',
  category: 'crafting',
  description: 'Craft a crafting table from 4 wooden planks in 2x2 inventory',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 20000,

  async execute(bot, args, context) {
    const tableDef = context.mcData.itemsByName['crafting_table']
    if (!tableDef) return { success: false, error: 'Crafting table definition not found' }

    // Resolve the first dependency instead of retrying an impossible recipe.
    const count = (name) => bot.inventory.items().filter((item) => item.name === name).reduce((sum, item) => sum + item.count, 0)
    if (count('oak_planks') + count('spruce_planks') + count('birch_planks') + count('jungle_planks') + count('acacia_planks') + count('dark_oak_planks') + count('mangrove_planks') + count('cherry_planks') < 4) {
      const logs = bot.inventory.items().find((item) => item.name.endsWith('_log') || item.name.endsWith('_wood'))
      if (logs) {
        const plankName = logs.name.replace(/_log|_wood/, '_planks')
        const plankDef = context.mcData.itemsByName[plankName]
        const plankRecipe = plankDef && bot.recipesFor(plankDef.id, null, 1, null)?.[0]
        if (plankRecipe) await bot.craft(plankRecipe, 1, null)
      }
    }

    const recipes = bot.recipesFor(tableDef.id, null, 1, null)
    if (!recipes || recipes.length === 0) {
      return { success: false, error: 'Cannot craft crafting table: needs at least 4 planks' }
    }

    await bot.craft(recipes[0], 1, null)

    return {
      success: true,
      crafted: 'crafting_table',
    }
  },
})

// ─── craft_item ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_item',
  name: 'Craft Generic Item',
  category: 'crafting',
  description: 'Craft any item specified by name using available recipes and crafting table if needed',
  arguments: {
    itemName: { type: 'string', required: true, description: 'Item name to craft' },
    quantity: { type: 'number', required: false, default: 1, description: 'Quantity to craft' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args, context) {
    let rawName = (args.itemName || '').toLowerCase().trim().replace(/^(an?\s+|the\s+)/, '').replace(/\s+/g, '_')

    // Auto-resolve generic tool names to specific tier based on available materials
    const tools = ['axe', 'pickaxe', 'sword', 'shovel', 'hoe']
    for (const t of tools) {
      if (rawName === t) {
        const inv = bot.inventory.items().map(i => i.name)
        if (inv.includes('diamond')) rawName = `diamond_${t}`
        else if (inv.includes('iron_ingot')) rawName = `iron_${t}`
        else if (inv.includes('cobblestone') || inv.includes('cobbled_deepslate')) rawName = `stone_${t}`
        else rawName = `wooden_${t}`
        break
      }
    }

    let itemDef = context.mcData.itemsByName[rawName] || context.mcData.blocksByName[rawName]
    if (!itemDef) {
      return { success: false, error: `Item '${rawName}' not found in Minecraft data` }
    }

    const requestedQuantity = args.quantity ?? 1
    const existingQuantity = bot.inventory.items()
      .filter(item => item.name === rawName)
      .reduce((total, item) => total + item.count, 0)
    if (existingQuantity >= requestedQuantity) {
      return { success: true, verified: true, crafted: rawName, quantity: 0, existing: existingQuantity, skipped: true }
    }

    // Auto-prepare sticks if needed for tools
    if (rawName.includes('_axe') || rawName.includes('_pickaxe') || rawName.includes('_sword') || rawName.includes('_shovel') || rawName.includes('_hoe')) {
      const sticks = bot.inventory.items().filter(i => i.name === 'stick').reduce((acc, i) => acc + i.count, 0)
      if (sticks < 2) {
        // Auto-craft planks from logs if 0 planks
        let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'))
        if (!planks) {
          const logs = bot.inventory.items().find(i => i.name.endsWith('_log') || i.name.endsWith('_wood'))
          if (logs) {
            const pDef = context.mcData.itemsByName[logs.name.replace(/_log|_wood/, '_planks')]
            if (pDef) {
              const pRec = bot.recipesFor(pDef.id, null, 1, null)
              if (pRec?.[0]) await bot.craft(pRec[0], 1, null)
            }
          }
        }
        // Craft sticks
        const stickDef = context.mcData.itemsByName['stick']
        if (stickDef) {
          const sRec = bot.recipesFor(stickDef.id, null, 1, null)
          if (sRec?.[0]) await bot.craft(sRec[0], 1, null)
        }
      }
    }

    // Check recipes without table first
    let recipes = bot.recipesFor(itemDef.id, null, 1, null)
    let craftingTableBlock = null

    if (!recipes || recipes.length === 0) {
      // Try with crafting table
      craftingTableBlock = await getOrPlaceCraftingTable(bot, context.mcData)
      if (craftingTableBlock) {
        bot.pathfinder.setGoal(new GoalGetToBlock(craftingTableBlock.position.x, craftingTableBlock.position.y, craftingTableBlock.position.z))
        await new Promise(r => setTimeout(r, 1200))
        recipes = bot.recipesFor(itemDef.id, null, 1, craftingTableBlock)
      }
    }

    if (!recipes || recipes.length === 0) {
      return {
        success: false,
        error: `Missing materials to craft '${rawName}'. Needs wood or stone.`,
      }
    }

    const qty = requestedQuantity
    await bot.craft(recipes[0], qty, craftingTableBlock)

    // Auto-equip if it's a tool or weapon
    const craftedItem = bot.inventory.items().find(i => i.name === rawName)
    if (craftedItem) {
      try {
        await bot.equip(craftedItem, 'hand')
      } catch {
        // ignore equip error
      }
    }

    return {
      success: true,
      crafted: rawName,
      quantity: qty,
      usedCraftingTable: craftingTableBlock !== null,
    }
  },
})

// ─── craft_wooden_tools ──────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_wooden_tools',
  name: 'Craft Wooden Tools',
  category: 'crafting',
  description: 'Craft a wooden pickaxe, axe, or sword',
  arguments: {
    tool: { type: 'string', required: false, default: 'wooden_pickaxe', description: 'Specific tool' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 45000,

  async execute(bot, args, context) {
    const tool = args.tool ?? 'wooden_pickaxe'
    return skillRegistry.get('craft_item').execute(bot, { itemName: tool, quantity: 1 }, context)
  },
})

// ─── craft_stone_tools ───────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_stone_tools',
  name: 'Craft Stone Tools',
  category: 'crafting',
  description: 'Craft a stone pickaxe, axe, sword, or shovel',
  arguments: {
    tool: { type: 'string', required: false, default: 'stone_pickaxe', description: 'Specific stone tool' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 45000,

  async execute(bot, args, context) {
    const tool = args.tool ?? 'stone_pickaxe'
    return skillRegistry.get('craft_item').execute(bot, { itemName: tool, quantity: 1 }, context)
  },
})

// ─── craft_iron_tools ────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_iron_tools',
  name: 'Craft Iron Tools',
  category: 'crafting',
  description: 'Craft an iron pickaxe, axe, sword, or shovel',
  arguments: {
    tool: { type: 'string', required: false, default: 'iron_pickaxe', description: 'Specific iron tool' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 45000,

  async execute(bot, args, context) {
    const tool = args.tool ?? 'iron_pickaxe'
    return skillRegistry.get('craft_item').execute(bot, { itemName: tool, quantity: 1 }, context)
  },
})

// ─── craft_diamond_tools ─────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_diamond_tools',
  name: 'Craft Diamond Tools',
  category: 'crafting',
  description: 'Craft a diamond pickaxe, axe, sword, or shovel',
  arguments: {
    tool: { type: 'string', required: false, default: 'diamond_pickaxe', description: 'Specific diamond tool' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 45000,

  async execute(bot, args, context) {
    const tool = args.tool ?? 'diamond_pickaxe'
    return skillRegistry.get('craft_item').execute(bot, { itemName: tool, quantity: 1 }, context)
  },
})

// ─── craft_furnace ───────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_furnace',
  name: 'Craft Furnace',
  category: 'crafting',
  description: 'Craft a furnace from 8 cobblestone at a crafting table',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 45000,

  async execute(bot, args, context) {
    return skillRegistry.get('craft_item').execute(bot, { itemName: 'furnace', quantity: 1 }, context)
  },
})

// ─── craft_chest ─────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_chest',
  name: 'Craft Chest',
  category: 'crafting',
  description: 'Craft a storage chest from 8 wooden planks at a crafting table',
  arguments: {
    quantity: { type: 'number', required: false, default: 1, description: 'Number of chests' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 45000,

  async execute(bot, args, context) {
    return skillRegistry.get('craft_item').execute(bot, { itemName: 'chest', quantity: args.quantity ?? 1 }, context)
  },
})

// ─── craft_torches ───────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_torches',
  name: 'Craft Torches',
  category: 'crafting',
  description: 'Craft torches from coal/charcoal and sticks (x4 per batch)',
  arguments: {
    batches: { type: 'number', required: false, default: 2, description: 'Recipe batches' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 20000,

  async execute(bot, args, context) {
    return skillRegistry.get('craft_item').execute(bot, { itemName: 'torch', quantity: args.batches ?? 2 }, context)
  },
})

// ─── craft_shield ────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'craft_shield',
  name: 'Craft Shield',
  category: 'crafting',
  description: 'Craft a shield using iron ingot and 6 planks at a crafting table',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 45000,

  async execute(bot, args, context) {
    return skillRegistry.get('craft_item').execute(bot, { itemName: 'shield', quantity: 1 }, context)
  },
})

// ─── smelt_ores ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'smelt_ores',
  name: 'Smelt Ores in Furnace',
  category: 'crafting',
  description: 'Smelt raw iron, copper, or gold ores into ingots using a furnace',
  arguments: {
    ore: { type: 'string', required: false, default: 'raw_iron', description: 'Raw ore item name' },
    quantity: { type: 'number', required: false, default: 4, description: 'Quantity to smelt' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 90000,

  async execute(bot, args, context) {
    const furnaceDef = context.mcData.blocksByName['furnace']
    if (!furnaceDef) return { success: false, error: 'Furnace definition not found' }

    const furnaceBlock = bot.findBlock({ matching: furnaceDef.id, maxDistance: 16 })
    if (!furnaceBlock) return { success: false, error: 'No furnace found nearby' }

    const items = bot.inventory.items()
    const rawOre = items.find(i => i.name === (args.ore ?? 'raw_iron') || i.name === 'iron_ore')
    if (!rawOre) return { success: false, error: `No ${args.ore ?? 'raw_iron'} to smelt in inventory` }

    const fuel = items.find(i => ['coal', 'charcoal', 'oak_planks', 'spruce_planks'].includes(i.name))
    if (!fuel) return { success: false, error: 'No fuel in inventory' }

    bot.pathfinder.setGoal(new GoalGetToBlock(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z))
    await new Promise(r => setTimeout(r, 2000))

    const furnace = await bot.openContainer(furnaceBlock)
    try {
      const smeltCount = Math.min(rawOre.count, args.quantity ?? 4)
      await furnace.deposit(rawOre.type, null, smeltCount)
      await furnace.deposit(fuel.type, null, 1)

      // Wait 10s for initial smelt
      await new Promise(r => setTimeout(r, 10000))

      const outputSlot = furnace.slots[2]
      if (outputSlot) {
        await furnace.withdraw(outputSlot.type, null, outputSlot.count)
      }
      furnace.close()
      return { success: true, smelted: rawOre.name, quantity: smeltCount }
    } catch (err) {
      furnace.close()
      return { success: false, error: err.message }
    }
  },
})

// ─── equip_tool ──────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'equip_tool',
  name: 'Equip Specific Tool or Weapon',
  category: 'crafting',
  description: 'Equip a tool or weapon into the main hand or armor slots',
  arguments: {
    itemName: { type: 'string', required: true, description: 'Tool or armor name' },
    slot: { type: 'string', required: false, default: 'hand', description: 'Equipment slot' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 10000,

  async execute(bot, args) {
    const item = bot.inventory.items().find(i => i.name === args.itemName)
    if (!item) {
      return { success: false, error: `Item '${args.itemName}' not found in inventory` }
    }

    const slot = args.slot ?? 'hand'
    await bot.equip(item, slot)

    return {
      success: true,
      equipped: item.name,
      slot,
    }
  },
})

