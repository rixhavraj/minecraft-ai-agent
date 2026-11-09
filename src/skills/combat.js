/**
 * Combat and Defense skills module for minecraft-ai-squad
 *
 * Implements hostile detection, threat evaluation, weapon/armor equipping,
 * attacking hostiles, base defense, and combat reports.
 */

import { skillRegistry } from './registry.js'
import { logger } from '../utils/logger.js'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

const { goals: { GoalFollow, GoalNear } } = pathfinderPackage
const log = logger.child({ component: 'CombatSkills' })

const HOSTILE_MOBS = new Set([
  'blaze', 'cave_spider', 'creeper', 'drowned', 'enderman', 'endermite',
  'evoker', 'ghast', 'guardian', 'hoglin', 'husk', 'magma_cube', 'phantom',
  'piglin_brute', 'pillager', 'ravager', 'silverfish', 'skeleton', 'slime',
  'spider', 'vex', 'vindicator', 'warden', 'witch', 'wither_skeleton', 'zoglin',
  'zombie', 'zombie_villager',
])

const combatHistory = []

// ─── equip_best_weapon ───────────────────────────────────────────────────────
skillRegistry.register({
  id: 'equip_best_weapon',
  name: 'Equip Best Weapon',
  category: 'combat',
  description: 'Find best sword or axe in inventory and equip in main hand; equip shield in off-hand',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 10000,

  async execute(bot) {
    const weaponRanking = [
      'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
      'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe',
    ]

    let bestWeapon = null
    for (const name of weaponRanking) {
      bestWeapon = bot.inventory.items().find(i => i.name === name)
      if (bestWeapon) break
    }

    if (bestWeapon) {
      await bot.equip(bestWeapon, 'hand')
    }

    // Check for shield in off-hand
    const shield = bot.inventory.items().find(i => i.name === 'shield')
    if (shield) {
      await bot.equip(shield, 'off-hand')
    }

    return {
      success: true,
      equippedWeapon: bestWeapon?.name ?? 'bare_hand',
      hasShield: shield !== undefined,
    }
  },
})

// ─── equip_best_armor ────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'equip_best_armor',
  name: 'Equip Best Armor Set',
  category: 'combat',
  description: 'Equip best available helmet, chestplate, leggings, and boots',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 15000,

  async execute(bot) {
    const slots = [
      { dest: 'head', types: ['netherite_helmet', 'diamond_helmet', 'iron_helmet', 'chainmail_helmet', 'leather_helmet'] },
      { dest: 'torso', types: ['netherite_chestplate', 'diamond_chestplate', 'iron_chestplate', 'chainmail_chestplate', 'leather_chestplate'] },
      { dest: 'legs', types: ['netherite_leggings', 'diamond_leggings', 'iron_leggings', 'chainmail_leggings', 'leather_leggings'] },
      { dest: 'feet', types: ['netherite_boots', 'diamond_boots', 'iron_boots', 'chainmail_boots', 'leather_boots'] },
    ]

    const equipped = {}
    for (const s of slots) {
      for (const armorName of s.types) {
        const item = bot.inventory.items().find(i => i.name === armorName)
        if (item) {
          try {
            await bot.equip(item, s.dest)
            equipped[s.dest] = item.name
            break
          } catch {
            // continue
          }
        }
      }
    }

    return {
      success: true,
      equipped,
    }
  },
})

// ─── evaluate_threat ────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'evaluate_threat',
  name: 'Evaluate Combat Threats',
  category: 'combat',
  description: 'Evaluate nearby hostile mobs, bot health, and recommend fight vs flee',
  arguments: {
    radius: { type: 'number', required: false, default: 16, description: 'Scan radius' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute(bot, args) {
    const radius = args.radius ?? 16
    const pos = bot.entity.position

    const hostiles = []
    for (const ent of Object.values(bot.entities)) {
      if (!ent.position || ent === bot.entity) continue
      if (HOSTILE_MOBS.has(ent.name)) {
        const dist = pos.distanceTo(ent.position)
        if (dist <= radius) {
          hostiles.push({ name: ent.name, distance: Number(dist.toFixed(1)) })
        }
      }
    }

    const health = bot.health ?? 20
    let recommendation = 'standby'
    let threatLevel = 'safe'

    if (hostiles.length > 0) {
      if (health <= 8 || hostiles.length >= 4) {
        threatLevel = 'critical'
        recommendation = 'flee_immediately'
      } else if (health <= 14 || hostiles.some(h => h.name === 'creeper' && h.distance < 6)) {
        threatLevel = 'high'
        recommendation = 'retreat_or_shelter'
      } else {
        threatLevel = 'moderate'
        recommendation = 'engage_hostiles'
      }
    }

    return {
      success: true,
      threatLevel,
      recommendation,
      hostilesCount: hostiles.length,
      hostiles,
      botHealth: health,
    }
  },
})

// ─── attack_hostile ──────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'attack_hostile',
  name: 'Attack Hostile Mob',
  category: 'combat',
  description: 'Engage and defeat a specific or nearest hostile mob with weapons',
  arguments: {
    targetMob: { type: 'string', required: false, description: 'Mob type or closest' },
    maxAttacks: { type: 'number', required: false, default: 20, description: 'Max hits' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 45000,

  async execute(bot, args, context) {
    // Equip weapon first
    await skillRegistry.get('equip_best_weapon').execute(bot, {}, context)

    const pos = bot.entity.position
    let target = null

    for (const ent of Object.values(bot.entities)) {
      if (!ent.position || ent === bot.entity) continue
      if (HOSTILE_MOBS.has(ent.name)) {
        if (!args.targetMob || ent.name === args.targetMob) {
          const dist = pos.distanceTo(ent.position)
          if (!target || dist < pos.distanceTo(target.position)) {
            target = ent
          }
        }
      }
    }

    if (!target) {
      return { success: true, message: 'No hostile mob in range to attack' }
    }

    const mobName = target.name
    let hits = 0
    bot.pathfinder.setGoal(new GoalFollow(target, 2), true)

    while (target.isValid && hits < (args.maxAttacks ?? 20)) {
      const dist = bot.entity.position.distanceTo(target.position)
      if (dist <= 3.5) {
        await bot.attack(target)
        hits++
        await new Promise(r => setTimeout(r, 650)) // Attack cooldown
      } else {
        await new Promise(r => setTimeout(r, 200))
      }

      // Check health safety check
      if ((bot.health ?? 20) <= 6) {
        bot.pathfinder.setGoal(null)
        combatHistory.push({ mob: mobName, result: 'retreated_low_health', hits })
        return { success: false, reason: 'Health dropped to critical; broke combat to survive', hits }
      }
    }

    bot.pathfinder.setGoal(null)
    const defeated = !target.isValid
    combatHistory.push({ mob: mobName, result: defeated ? 'victory' : 'timeout', hits })

    return {
      success: defeated,
      mob: mobName,
      hitsLanded: hits,
      defeated,
    }
  },
})

// ─── defend_base ─────────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'defend_base',
  name: 'Defend Base Perimeter',
  category: 'combat',
  description: 'Patrol base perimeter and eliminate any approaching hostiles',
  arguments: {
    radius: { type: 'number', required: false, default: 16, description: 'Defense radius' },
    durationMs: { type: 'number', required: false, default: 30000, description: 'Guard duration' },
  },
  requires: [],
  permissions: ['*'],
  timeout: 60000,

  async execute(bot, args, context) {
    const radius = args.radius ?? 16
    const duration = args.durationMs ?? 30000
    const start = Date.now()
    const homePos = bot.entity.position.clone()

    let mobsDefeated = 0

    while (Date.now() - start < duration) {
      const threat = await skillRegistry.get('evaluate_threat').execute(bot, { radius }, context)
      if (threat.hostilesCount > 0 && threat.recommendation === 'engage_hostiles') {
        const attackRes = await skillRegistry.get('attack_hostile').execute(bot, {}, context)
        if (attackRes.defeated) mobsDefeated++
      } else {
        // Return to home position if wandered off
        if (bot.entity.position.distanceTo(homePos) > 4) {
          bot.pathfinder.setGoal(new GoalNear(homePos.x, homePos.y, homePos.z, 2))
        }
        await new Promise(r => setTimeout(r, 3000))
      }
    }

    return {
      success: true,
      durationMs: duration,
      mobsDefeated,
    }
  },
})

// ─── combat_report ───────────────────────────────────────────────────────────
skillRegistry.register({
  id: 'combat_report',
  name: 'Generate Combat Report',
  category: 'combat',
  description: 'Retrieve summary of recent combat engagements and victories',
  arguments: {},
  requires: [],
  permissions: ['*'],
  timeout: 5000,

  async execute() {
    return {
      success: true,
      totalEngagements: combatHistory.length,
      history: combatHistory.slice(-10),
    }
  },
})

