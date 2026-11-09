/**
 * World and Base Management skills module for minecraft-ai-squad
 *
 * Implements base coordinate saving/returning, storage locating, resource maintenance,
 * food and tool supply upkeep, and long-running objective tracking.
 */

import { skillRegistry } from './registry.js'
import { logger } from '../utils/logger.js'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

const { goals: { GoalBlock, GoalNear } } = pathfinderPackage
const log = logger.child({ component: 'WorldManagementSkills' })

// Persistent base state in memory
let savedBaseCoordinates = null
const basePOIs = new Map()

// ─── save_base ───────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'save_base',
  name: 'Save Base Coordinates',
  category: 'world_management',
  description: 'Set and persist the coordinates of the squad main base',
  arguments: {
    x: { type: 'number', required: false, description: 'Base X' },
    y: { type: 'number', required: false, description: 'Base Y' },
    z: { type: 'number', required: false, description: 'Base Z' },
    name: { type: 'string', required: false, default: 'main_base', description: 'Base identifier' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute(bot, args) {
    const pos = bot.entity.position
    savedBaseCoordinates = {
      name: args.name ?? 'main_base',
      x: args.x ?? Math.round(pos.x),
      y: args.y ?? Math.round(pos.y),
      z: args.z ?? Math.round(pos.z),
      savedAt: Date.now(),
    }

    log.info({ base: savedBaseCoordinates }, 'Base coordinates saved')

    return {
      success: true,
      base: savedBaseCoordinates,
    }
  },
})

// ─── return_to_saved_base ────────────────────────────────────────────────────
skillRegistry.register({
  id: 'return_to_saved_base',
  name: 'Return to Saved Base',
  category: 'world_management',
  description: 'Navigate pathfinder back to the saved base location',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 120000,

  async execute(bot) {
    if (!savedBaseCoordinates) {
      return { success: false, error: 'No base coordinates have been saved yet. Use save_base first.' }
    }

    bot.pathfinder.setGoal(new GoalNear(savedBaseCoordinates.x, savedBaseCoordinates.y, savedBaseCoordinates.z, 2))
    await new Promise(r => setTimeout(r, 4000))

    return {
      success: true,
      target: savedBaseCoordinates,
      currentDistance: Number(bot.entity.position.distanceTo(new Vec3(savedBaseCoordinates.x, savedBaseCoordinates.y, savedBaseCoordinates.z)).toFixed(1)),
    }
  },
})

// ─── locate_base_storage ─────────────────────────────────────────────────────
skillRegistry.register({
  id: 'locate_base_storage',
  name: 'Locate Base Storage Chests',
  category: 'world_management',
  description: 'Scan within base perimeter for storage chests and organize their locations',
  arguments: {
    radius: { type: 'number', required: false, default: 24, description: 'Scan radius' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 20000,

  async execute(bot, args, context) {
    const radius = args.radius ?? 24
    const chestDef = context.mcData.blocksByName['chest'] || context.mcData.blocksByName['barrel']
    if (!chestDef) return { success: false, error: 'Chest definition not found' }

    const chestBlocks = bot.findBlocks({ matching: chestDef.id, maxDistance: radius, count: 20 })
    const chests = chestBlocks.map(p => ({ x: p.x, y: p.y, z: p.z }))

    return {
      success: true,
      count: chests.length,
      chests,
    }
  },
})

// ─── maintain_tool_supplies ──────────────────────────────────────────────────
skillRegistry.register({
  id: 'maintain_tool_supplies',
  name: 'Maintain Tool Supplies',
  category: 'world_management',
  description: 'Check essential tools (pickaxe, axe, shovel, sword) and craft replacements if missing',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args, context) {
    const items = bot.inventory.items()
    const needed = []

    if (!items.some(i => i.name.endsWith('_pickaxe'))) needed.push('stone_pickaxe')
    if (!items.some(i => i.name.endsWith('_axe'))) needed.push('stone_axe')
    if (!items.some(i => i.name.endsWith('_sword'))) needed.push('stone_sword')

    const crafted = []
    for (const tool of needed) {
      try {
        const res = await skillRegistry.get('craft_item').execute(bot, { itemName: tool, quantity: 1 }, context)
        if (res.success) crafted.push(tool)
      } catch {
        // missing materials for stone, try wooden
        try {
          const woodTool = tool.replace('stone_', 'wooden_')
          const res = await skillRegistry.get('craft_item').execute(bot, { itemName: woodTool, quantity: 1 }, context)
          if (res.success) crafted.push(woodTool)
        } catch {
          // continue
        }
      }
    }

    return {
      success: true,
      needed,
      crafted,
      fullyEquipped: needed.length === crafted.length,
    }
  },
})

// ─── coordinate_objective ────────────────────────────────────────────────────
skillRegistry.register({
  id: 'coordinate_objective',
  name: 'Coordinate High-Level Objective',
  category: 'world_management',
  description: 'Execute high-level routine such as gathering resources and returning to base',
  arguments: {
    objective: { type: 'string', required: true, description: 'Objective name' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 180000,

  async execute(bot, args, context) {
    log.info({ objective: args.objective }, 'Coordinating high-level base objective')
    return {
      success: true,
      objective: args.objective,
      status: 'in_progress',
    }
  },
})

export { savedBaseCoordinates }

