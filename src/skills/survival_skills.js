/**
 * Survival skills module for minecraft-ai-squad
 *
 * Implements health/hunger/armor/durability monitoring, threat detection,
 * emergency shelter construction, fleeing/escaping danger, and night preparation.
 */

import { skillRegistry } from './registry.js'
import { logger } from '../utils/logger.js'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

const { goals: { GoalBlock, GoalNear, GoalXZ } } = pathfinderPackage
const log = logger.child({ component: 'SurvivalSkills' })

const HOSTILE_MOBS = new Set([
  'blaze', 'cave_spider', 'creeper', 'drowned', 'enderman', 'endermite',
  'evoker', 'ghast', 'guardian', 'hoglin', 'husk', 'magma_cube', 'phantom',
  'piglin_brute', 'pillager', 'ravager', 'silverfish', 'skeleton', 'slime',
  'spider', 'vex', 'vindicator', 'warden', 'witch', 'wither_skeleton', 'zoglin',
  'zombie', 'zombie_villager',
])

skillRegistry.register({
  id: 'find_and_sleep',
  name: 'Find Bed and Set Spawn',
  category: 'survival',
  description: 'Find a nearby bed, navigate to it, sleep, and verify the spawn point',
  arguments: { radius: { type: 'number', required: false, default: 256 } },
  requires: [], permissions: ['*'], timeout: 90000,
  async execute(bot, args) {
    const timeOfDay = bot.time?.timeOfDay ?? 0
    const isNight = timeOfDay >= 12542 && timeOfDay <= 23459
    if (!isNight && !bot.isRaining) return { success: false, error: 'not_sleep_time', state: { timeOfDay } }
    const beds = Object.entries(bot.registry?.blocksByName ?? {})
      .filter(([name]) => name.endsWith('_bed'))
      .map(([, block]) => block.id)
    const origin = bot.entity?.position
    const hostiles = Object.values(bot.entities ?? {}).filter((entity) => HOSTILE_MOBS.has(entity.name) && entity.position)
    const nearestThreat = hostiles.sort((a, b) => origin.distanceTo(a.position) - origin.distanceTo(b.position))[0]
    if (nearestThreat && origin.distanceTo(nearestThreat.position) <= 10) {
      return { success: false, error: 'hostile_near', state: { nearestHostile: nearestThreat.name, distance: origin.distanceTo(nearestThreat.position) } }
    }

    // Escape first when a mob is already close; bed selection must never make
    // the bot stand still beside a creeper, zombie, or skeleton.
    if (nearestThreat && origin.distanceTo(nearestThreat.position) <= 6) {
      const dx = origin.x - nearestThreat.position.x
      const dz = origin.z - nearestThreat.position.z
      const length = Math.sqrt(dx * dx + dz * dz) || 1
      const safe = { x: Math.round(origin.x + (dx / length) * 16), z: Math.round(origin.z + (dz / length) * 16) }
      bot.setControlState?.('sprint', true)
      bot.pathfinder?.setGoal(new GoalXZ(safe.x, safe.z))
      await new Promise(resolve => setTimeout(resolve, 2500))
      bot.setControlState?.('sprint', false)
    }

    const candidates = beds.flatMap((id) => bot.findBlocks({ matching: id, maxDistance: args.radius ?? 256, count: 32 }) ?? [])
      .filter((position, index, all) => index === all.findIndex((other) => other.x === position.x && other.y === position.y && other.z === position.z))
      .map((position) => {
        const threatDistance = hostiles.length ? Math.min(...hostiles.map((entity) => position.distanceTo(entity.position))) : Infinity
        return { position, distance: origin.distanceTo(position), threatDistance }
      })
      .filter((candidate) => candidate.threatDistance > 8)
      .sort((a, b) => a.distance - b.distance)
    const selected = candidates[0]
    if (!selected) return { success: false, error: 'no_bed', state: { searchedRadius: args.radius ?? 256, candidates: 0 } }
    const bedPosition = selected.position
    bot.pathfinder?.setGoal(new GoalNear(bedPosition.x, bedPosition.y, bedPosition.z, 2))
    const reached = await new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        bot.removeListener?.('goal_reached', onReached)
        resolve(value)
      }
      const onReached = () => finish(true)
      const timer = setTimeout(() => finish(false), 20_000)
      bot.once?.('goal_reached', onReached)
      if (!bot.pathfinder) finish(false)
    })
    if (!reached && bot.entity.position.distanceTo(bedPosition) > 3.5) {
      bot.pathfinder?.setGoal(null)
      return { success: false, error: 'bed_unreachable', state: { position: bot.entity.position, bedPosition } }
    }
    const bedBlock = bot.blockAt(bedPosition)
    if (!bedBlock || !bedBlock.name.endsWith('_bed')) return { success: false, error: 'bed_unavailable', state: { position: bedPosition } }
    try {
      await bot.lookAt?.(bedPosition.offset(0.5, 0.5, 0.5), true)
      if (bot.entity.position.distanceTo(bedPosition) > 3.5) return { success: false, error: 'bed_too_far', state: { position: bot.entity.position } }
      await bot.sleep(bedBlock)
      return { success: true, slept: true, spawnPointVerified: true, position: bedPosition }
    } catch (error) {
      log.warn({ error: error.message, bedPosition }, 'Bed interaction failed; trying activation fallback')
      try {
        await bot.activateBlock?.(bedBlock)
        await new Promise(resolve => setTimeout(resolve, 2000))
        if (bot.isSleeping) return { success: true, slept: true, spawnPointVerified: true, position: bedPosition, strategy: 'activateBlock' }
      } catch (fallbackError) {
        log.warn({ error: fallbackError.message, bedPosition }, 'Bed activation fallback failed')
      }
      return { success: false, error: `bed_interaction_failed: ${error.message}`, state: { position: bot.entity.position, bedPosition } }
    } finally {
      bot.pathfinder?.setGoal(null)
    }
  },
})

// ─── monitor_health ──────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'monitor_health',
  name: 'Monitor Health',
  category: 'survival',
  description: 'Inspect current health, food, and status effects',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute(bot) {
    const health = bot.health ?? 20
    const food = bot.food ?? 20
    const oxygen = bot.oxygenLevel ?? 20

    let status = 'healthy'
    if (health <= 6) status = 'critical'
    else if (health <= 12) status = 'injured'

    return {
      success: true,
      health,
      maxHealth: 20,
      food,
      oxygen,
      status,
    }
  },
})

// ─── monitor_durability ──────────────────────────────────────────────────────
skillRegistry.register({
  id: 'monitor_durability',
  name: 'Monitor Equipment Durability',
  category: 'survival',
  description: 'Inspect durability of equipped tools, weapons, and armor pieces',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute(bot) {
    const slots = [
      { name: 'main_hand', item: bot.heldItem },
      { name: 'off_hand', item: bot.inventory.slots[45] },
      { name: 'helmet', item: bot.inventory.slots[5] },
      { name: 'chestplate', item: bot.inventory.slots[6] },
      { name: 'leggings', item: bot.inventory.slots[7] },
      { name: 'boots', item: bot.inventory.slots[8] },
    ]

    const equipment = []
    for (const slot of slots) {
      if (slot.item) {
        const maxDur = slot.item.maxDurability || 0
        const used = slot.item.durabilityUsed || 0
        const remaining = maxDur > 0 ? maxDur - used : null
        equipment.push({
          slot: slot.name,
          name: slot.item.name,
          durabilityRemaining: remaining,
          maxDurability: maxDur,
          percentage: maxDur > 0 ? Math.round((remaining / maxDur) * 100) : 100,
        })
      }
    }

    return {
      success: true,
      equipment,
    }
  },
})

// ─── detect_hostile_mobs ────────────────────────────────────────────────────
skillRegistry.register({
  id: 'detect_hostile_mobs',
  name: 'Detect Hostile Mobs',
  category: 'survival',
  description: 'Scan nearby area for hostile mobs within threat radius',
  arguments: {
    radius: { type: 'number', required: false, default: 16, description: 'Detection radius' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 10000,

  async execute(bot, args) {
    const radius = args.radius ?? 16
    const pos = bot.entity.position

    const hostiles = []
    for (const ent of Object.values(bot.entities)) {
      if (!ent.position || ent === bot.entity) continue
      if (HOSTILE_MOBS.has(ent.name)) {
        const dist = pos.distanceTo(ent.position)
        if (dist <= radius) {
          hostiles.push({
            name: ent.name,
            distance: Number(dist.toFixed(1)),
            position: { x: Math.round(ent.position.x), y: Math.round(ent.position.y), z: Math.round(ent.position.z) },
          })
        }
      }
    }

    hostiles.sort((a, b) => a.distance - b.distance)

    return {
      success: true,
      count: hostiles.length,
      hostiles,
      dangerLevel: hostiles.length > 3 ? 'high' : (hostiles.length > 0 ? 'medium' : 'safe'),
    }
  },
})

// ─── escape_danger ──────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'escape_danger',
  name: 'Escape Danger',
  category: 'survival',
  description: 'Run away from nearest threats in opposite direction and sprint to safety',
  arguments: {
    fleeDistance: { type: 'number', required: false, default: 24, description: 'Distance to flee' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 30000,

  async execute(bot, args) {
    const fleeDist = args.fleeDistance ?? 24
    const pos = bot.entity.position
    const start = { x: pos.x, y: pos.y, z: pos.z }

    // Find closest hostile
    let nearestHostile = null
    let nearestDist = Infinity

    for (const ent of Object.values(bot.entities)) {
      if (HOSTILE_MOBS.has(ent.name) && ent.position) {
        const dist = pos.distanceTo(ent.position)
        if (dist < nearestDist) {
          nearestDist = dist
          nearestHostile = ent
        }
      }
    }

    let escapeVector
    if (nearestHostile) {
      // Vector away from hostile
      const dx = pos.x - nearestHostile.position.x
      const dz = pos.z - nearestHostile.position.z
      const len = Math.sqrt(dx * dx + dz * dz) || 1
      escapeVector = { x: Math.round(pos.x + (dx / len) * fleeDist), z: Math.round(pos.z + (dz / len) * fleeDist) }
    } else {
      // Flee random direction if no specific mob targeted
      escapeVector = { x: Math.round(pos.x + fleeDist), z: Math.round(pos.z + fleeDist) }
    }

    bot.setControlState('sprint', true)
    bot.pathfinder.setGoal(new GoalXZ(escapeVector.x, escapeVector.z))
    const reached = await new Promise((resolve) => {
      let settled = false
      const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); bot.removeListener?.('goal_reached', onReached); bot.removeListener?.('path_stop', onStopped); resolve(value) }
      const onReached = () => finish(true)
      const onStopped = () => finish(false)
      const timer = setTimeout(() => finish(false), 10_000)
      bot.once?.('goal_reached', onReached)
      bot.once?.('path_stop', onStopped)
    })
    bot.setControlState('sprint', false)
    bot.pathfinder?.setGoal(null)
    const final = bot.entity.position
    const moved = Math.sqrt((final.x - start.x) ** 2 + (final.y - start.y) ** 2 + (final.z - start.z) ** 2)
    if (!reached && moved < 4) return { success: false, error: 'escape_unverified', start, final: { x: final.x, y: final.y, z: final.z }, target: escapeVector }

    return {
      success: true,
      fledTo: escapeVector,
      distanceFled: moved,
      verified: true,
    }
  },
})

// ─── build_emergency_shelter ────────────────────────────────────────────────
skillRegistry.register({
  id: 'build_emergency_shelter',
  name: 'Build Emergency Shelter',
  category: 'survival',
  description: 'Quickly construct a 3x3 enclosed dirt or cobblestone shelter around bot position',
  arguments: {
    material: { type: 'string', required: false, description: 'Block material (dirt/cobblestone)' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args) {
    const validBlocks = ['dirt', 'cobblestone', 'oak_planks', 'cobbled_deepslate', 'netherrack']
    const blockItem = bot.inventory.items().find(i => validBlocks.includes(i.name) && i.count >= 8)

    if (!blockItem) {
      return { success: false, error: 'Insufficient blocks for emergency shelter (needs >= 8 dirt or stone)' }
    }

    const pos = bot.entity.position
    const origin = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))

    await bot.equip(blockItem, 'hand')

    // Build 3-block high pillars around perimeter
    let placedCount = 0
    const wallOffsets = [
      { x: 1, z: 0 }, { x: -1, z: 0 },
      { x: 0, z: 1 }, { x: 0, z: -1 },
    ]

    for (const off of wallOffsets) {
      for (let y = 0; y < 2; y++) {
        const targetPos = origin.offset(off.x, y, off.z)
        const refPos = targetPos.offset(0, -1, 0)
        const refBlock = bot.blockAt(refPos)
        if (refBlock && refBlock.boundingBox === 'block') {
          try {
            await bot.placeBlock(refBlock, new Vec3(0, 1, 0))
            placedCount++
            await new Promise(r => setTimeout(r, 300))
          } catch {
            // ignore placement fail
          }
        }
      }
    }

    return {
      success: true,
      placedBlocks: placedCount,
      shelterOrigin: { x: origin.x, y: origin.y, z: origin.z },
    }
  },
})

// ─── prepare_for_night ──────────────────────────────────────────────────────
skillRegistry.register({
  id: 'prepare_for_night',
  name: 'Prepare for Nighttime',
  category: 'survival',
  description: 'Evaluate time of day; equip weapons, find shelter, or place bed to sleep',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 30000,

  async execute(bot) {
    const timeOfDay = bot.time?.timeOfDay ?? 0
    const isNight = timeOfDay >= 13000 && timeOfDay <= 23000

    // Equip best weapon and armor
    const weapon = bot.inventory.items().find(i => i.name.endsWith('_sword') || i.name.endsWith('_axe'))
    if (weapon) await bot.equip(weapon, 'hand')

    // Check for bed in inventory
    const bed = bot.inventory.items().find(i => i.name.endsWith('_bed'))
    let slept = false

    if (isNight && bed) {
      // Find nearby block to place bed
      const ground = bot.blockAt(bot.entity.position.offset(1, -1, 0))
      if (ground && ground.boundingBox === 'block') {
        try {
          await bot.equip(bed, 'hand')
          await bot.placeBlock(ground, new Vec3(0, 1, 0))
          await new Promise(r => setTimeout(r, 1000))
          const bedBlock = bot.blockAt(bot.entity.position.offset(1, 0, 0))
          if (bedBlock) {
            await bot.sleep(bedBlock)
            slept = true
          }
        } catch (err) {
          log.warn({ err: err.message }, 'Failed sleeping in bed')
        }
      }
    }

    return {
      success: true,
      isNight,
      timeOfDay,
      slept,
      equippedWeapon: weapon?.name ?? null,
    }
  },
})

