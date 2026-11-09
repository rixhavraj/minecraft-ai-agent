import { skillRegistry } from './registry.js'

function count(bot, names) {
  const allowed = new Set(Array.isArray(names) ? names : [names])
  return bot.inventory.items().filter((item) => allowed.has(item.name)).reduce((sum, item) => sum + item.count, 0)
}

function equipment(bot) {
  return bot.inventory.slots.slice(5, 9).filter(Boolean).map((item) => item.name)
}

skillRegistry.register({
  id: 'assess_nether_readiness',
  name: 'Assess Nether Readiness',
  category: 'world_management',
  description: 'Evaluate actual inventory, equipment, food, and portal prerequisites before Nether travel',
  arguments: {},
  timeout: 5000,
  async execute(bot) {
    const armor = equipment(bot)
    const checks = {
      obsidianOrPortal: count(bot, ['obsidian', 'flint_and_steel']) > 0,
      weapon: count(bot, ['iron_sword', 'diamond_sword', 'netherite_sword', 'iron_axe', 'diamond_axe']) > 0,
      pickaxe: count(bot, ['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe']) > 0,
      food: count(bot, ['cooked_beef', 'cooked_porkchop', 'bread', 'baked_potato', 'golden_carrot']) >= 8,
      armor: armor.length >= 2,
      shield: count(bot, 'shield') > 0,
      fireProtection: count(bot, ['fire_resistance', 'potion']) > 0,
    }
    const required = ['weapon', 'pickaxe', 'food', 'armor', 'shield']
    const ready = required.every((key) => checks[key])
    return { success: true, ready, dimension: bot.game?.dimension ?? null, checks, missing: required.filter((key) => !checks[key]), armor }
  },
})

skillRegistry.register({
  id: 'locate_nether_fortress',
  name: 'Locate Nether Fortress',
  category: 'world_management',
  description: 'Locate visible Nether fortress blocks in the loaded world and record their coordinates',
  arguments: { maxDistance: { type: 'number', required: false, default: 128 } },
  timeout: 10000,
  async execute(bot, args, context) {
    if (bot.game?.dimension !== 'nether') return { success: false, error: 'Bot must be in the Nether to locate a fortress' }
    const block = context.mcData.blocksByName.nether_bricks
    if (!block) return { success: false, error: 'Minecraft data has no nether_bricks block' }
    const position = bot.findBlock({ matching: block.id, maxDistance: args.maxDistance ?? 128 })
    if (!position) return { success: false, error: 'No loaded Nether fortress blocks found within search radius' }
    return { success: true, verified: true, structure: 'nether_fortress_candidate', position: { x: position.x, y: position.y, z: position.z } }
  },
})

skillRegistry.register({
  id: 'assess_blaze_progress',
  name: 'Assess Blaze Progress',
  category: 'world_management',
  description: 'Verify blaze rods in inventory or visible blaze entities before End preparation',
  arguments: {},
  timeout: 5000,
  async execute(bot) {
    const rods = count(bot, 'blaze_rod')
    const visibleBlazes = Object.values(bot.entities ?? {}).filter(entity => entity.name === 'blaze').length
    return { success: true, verified: true, blazeRods: rods, visibleBlazes, readyForEyes: rods >= 6, missing: Math.max(0, 6 - rods) }
  },
})

skillRegistry.register({
  id: 'locate_stronghold_portal',
  name: 'Locate Stronghold Portal',
  category: 'world_management',
  description: 'Locate an End portal frame in loaded chunks; does not claim a stronghold from unloaded terrain',
  arguments: { maxDistance: { type: 'number', required: false, default: 128 } },
  timeout: 10000,
  async execute(bot, args, context) {
    const block = context.mcData.blocksByName.end_portal_frame
    if (!block) return { success: false, error: 'Minecraft data has no end_portal_frame block' }
    const position = bot.findBlock({ matching: block.id, maxDistance: args.maxDistance ?? 128 })
    if (!position) return { success: false, error: 'No loaded End portal frame found within search radius' }
    return { success: true, verified: true, structure: 'end_portal_frame', position: { x: position.x, y: position.y, z: position.z } }
  },
})

skillRegistry.register({
  id: 'enter_end_portal',
  name: 'Enter End Portal',
  category: 'world_management',
  description: 'Stand on a loaded active End portal and verify the dimension changes to the End',
  arguments: { position: { type: 'object', required: true } },
  timeout: 30000,
  async execute(bot, args, context) {
    const target = args.position
    const portal = bot.blockAt({ x: target.x, y: target.y, z: target.z })
    const portalId = context.mcData.blocksByName.end_portal?.id
    if (!portal || portal.type !== portalId) return { success: false, error: 'Target is not an active loaded End portal block' }
    bot.pathfinder.setGoal(new context.GoalNear(target.x, target.y, target.z, 1))
    const startDimension = bot.game?.dimension
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      if (bot.game?.dimension === 'the_end' || bot.game?.dimension === 'end') return { success: true, verified: true, from: startDimension, to: bot.game.dimension }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    return { success: false, error: 'End dimension transition was not observed', verified: false }
  },
})

skillRegistry.register({
  id: 'assess_end_readiness',
  name: 'Assess End Readiness',
  category: 'world_management',
  description: 'Evaluate actual supplies for stronghold and End preparation without claiming progression',
  arguments: {},
  timeout: 5000,
  async execute(bot) {
    const checks = {
      eyesOfEnder: count(bot, 'ender_eye') >= 12,
      rangedWeapon: count(bot, ['bow', 'crossbow']) > 0,
      arrows: count(bot, ['arrow', 'spectral_arrow']) >= 32,
      food: count(bot, ['cooked_beef', 'cooked_porkchop', 'bread', 'golden_carrot']) >= 16,
      armor: equipment(bot).length >= 4,
      waterBucket: count(bot, 'water_bucket') > 0,
      blocks: count(bot, ['cobblestone', 'stone', 'netherrack']) >= 64,
    }
    const required = Object.keys(checks)
    const ready = required.every((key) => checks[key])
    return { success: true, ready, checks, missing: required.filter((key) => !checks[key]), dimension: bot.game?.dimension ?? null }
  },
})
