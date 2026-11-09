import { skillRegistry } from './registry.js'
import pathfinderPackage from 'mineflayer-pathfinder'

const { goals: { GoalNear } } = pathfinderPackage

function waitForDimensionChange(bot, before, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const current = bot.game?.dimension ?? null
      if (current && current !== before) {
        clearInterval(timer)
        resolve({ changed: true, dimension: current })
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer)
        resolve({ changed: false, dimension: current })
      }
    }, 250)
    timer.unref?.()
  })
}

skillRegistry.register({
  id: 'inspect_portals',
  name: 'Inspect Nearby Portals',
  category: 'world_management',
  description: 'Observe nearby Nether portal blocks and current dimension',
  arguments: { radius: { type: 'number', required: false, default: 32 } },
  timeout: 10000,
  async execute(bot, args) {
    const radius = Math.min(args.radius ?? 32, 128)
    const names = ['nether_portal', 'obsidian']
    const portals = []
    for (const name of names) {
      const block = bot.registry?.blocksByName?.[name]
      if (!block) continue
      const positions = bot.findBlocks({ matching: block.id, maxDistance: radius, count: 32 })
      portals.push(...positions.map((position) => ({ block: name, position: { x: position.x, y: position.y, z: position.z } })))
    }
    return { success: true, dimension: bot.game?.dimension ?? null, portals }
  },
})

skillRegistry.register({
  id: 'travel_by_vehicle',
  name: 'Travel by Boat or Minecart',
  category: 'world_management',
  description: 'Mount a nearby boat or minecart, travel under Mineflayer controls, and verify movement',
  arguments: {
    vehicle: { type: 'string', required: false, default: 'boat' },
    durationMs: { type: 'number', required: false, default: 4000 },
    radius: { type: 'number', required: false, default: 8 },
  },
  timeout: 20000,
  async execute(bot, args) {
    const requested = String(args.vehicle ?? 'boat').toLowerCase()
    const names = requested.includes('minecart') ? new Set(['minecart', 'chest_minecart', 'hopper_minecart']) : new Set(['boat', 'chest_boat'])
    const origin = bot.entity?.position?.clone?.() ?? bot.entity?.position
    const vehicle = Object.values(bot.entities ?? {})
      .filter(entity => names.has(entity.name) && entity.position && origin?.distanceTo(entity.position) <= (args.radius ?? 8))
      .sort((a, b) => origin.distanceTo(a.position) - origin.distanceTo(b.position))[0]
    if (!vehicle) return { success: false, error: `No nearby ${requested} vehicle found` }
    if (typeof bot.mount !== 'function') return { success: false, error: 'Mineflayer mount API is unavailable' }
    try {
      await bot.mount(vehicle)
      bot.setControlState?.('forward', true)
      await new Promise(resolve => setTimeout(resolve, Math.min(args.durationMs ?? 4000, 10000)))
      bot.setControlState?.('forward', false)
      await bot.dismount?.()
    } finally {
      bot.setControlState?.('forward', false)
    }
    const finalPosition = bot.entity?.position
    const distance = origin && finalPosition ? origin.distanceTo(finalPosition) : 0
    if (distance < 1) return { success: false, error: 'Vehicle ride completed without verified movement', vehicle: vehicle.name, distance }
    return { success: true, verified: true, vehicle: vehicle.name, distance, position: { x: finalPosition.x, y: finalPosition.y, z: finalPosition.z } }
  },
})

skillRegistry.register({
  id: 'use_portal',
  name: 'Use Nether Portal',
  category: 'world_management',
  description: 'Navigate to a nearby active Nether portal and verify a dimension transition',
  arguments: { radius: { type: 'number', required: false, default: 32 }, timeoutMs: { type: 'number', required: false, default: 15000 } },
  timeout: 30000,
  async execute(bot, args) {
    const portal = bot.registry?.blocksByName?.nether_portal
    if (!portal) return { success: false, error: 'This Minecraft version has no nether_portal block definition' }
    const position = bot.findBlock({ matching: portal.id, maxDistance: Math.min(args.radius ?? 32, 128) })
    if (!position) return { success: false, error: 'No active Nether portal found within range' }
    const beforeDimension = bot.game?.dimension ?? null
    bot.pathfinder.setGoal(new GoalNear(position.x, position.y, position.z, 2))
    const result = await waitForDimensionChange(bot, beforeDimension, args.timeoutMs ?? 15000)
    bot.pathfinder.setGoal(null)
    if (!result.changed) return { success: false, error: 'Portal did not produce a verified dimension transition', beforeDimension, afterDimension: result.dimension, position: bot.entity?.position }
    return { success: true, beforeDimension, afterDimension: result.dimension, position: { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } }
  },
})
