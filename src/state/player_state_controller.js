import { EventEmitter } from 'node:events'
import { memoryStore } from '../database/memory_store.js'

function positionOf(entity) {
  if (!entity?.position) return null
  return { x: Number(entity.position.x), y: Number(entity.position.y), z: Number(entity.position.z) }
}

function itemCounts(items = []) {
  return items.reduce((result, item) => {
    result[item.name] = (result[item.name] ?? 0) + item.count
    return result
  }, {})
}

/**
 * One authoritative, observation-only view of the Mineflayer player.
 * Consumers should use snapshots instead of independently guessing bot state.
 */
export class PlayerStateController extends EventEmitter {
  constructor(bot, { intervalMs = 1000, now = Date.now, worldId = null } = {}) {
    super()
    this.bot = bot
    this.intervalMs = intervalMs
    this.now = now
    this.worldId = worldId
    this.timer = undefined
    this.state = this.snapshot()
  }

  snapshot() {
    const bot = this.bot
    const position = positionOf(bot.entity)
    const dimension = bot.game?.dimension ?? bot.world?.dimension ?? null
    const items = bot.inventory?.items?.() ?? []
    const entities = Object.values(bot.entities ?? {}).map((entity) => ({
      id: entity.id,
      name: entity.name ?? null,
      type: entity.type ?? null,
      position: positionOf(entity),
      distance: position && entity.position ? Number(positionOf(entity) && bot.entity.position.distanceTo(entity.position).toFixed(2)) : null,
    }))

    return {
      observedAt: new Date(this.now()).toISOString(),
      source: 'mineflayer',
      connected: bot.player != null || bot.entity != null,
      username: bot.username ?? null,
      health: bot.health ?? null,
      food: bot.food ?? null,
      saturation: bot.foodSaturation ?? null,
      experience: bot.experience ? { level: bot.experience.level ?? 0, points: bot.experience.points ?? 0 } : null,
      position,
      velocity: bot.entity?.velocity ? positionOf({ position: bot.entity.velocity }) : null,
      dimension,
      biome: position && typeof bot.world?.getBiome === 'function' ? bot.world.getBiome(position) : null,
      timeOfDay: bot.time?.timeOfDay ?? null,
      weather: bot.isRaining ? 'rain' : 'clear',
      inventory: itemCounts(items),
      inventorySlotsUsed: items.length,
      equipment: (bot.inventory?.slots ?? []).slice(5, 9).map((item) => item?.name ?? null),
      heldItem: bot.heldItem?.name ?? null,
      nearbyEntities: entities,
      activeTask: this.state?.activeTask ?? null,
    }
  }

  refresh() {
    const previous = this.state
    this.state = this.snapshot()
    if (this.state.username) {
      const observedWorldId = this.worldId ?? this.bot.game?.levelType ?? this.bot.world?.name ?? `${this.bot._client?.serverHost ?? 'minecraft'}:${this.bot._client?.serverPort ?? ''}`
      memoryStore.upsertWorldSession({ worldId: observedWorldId, username: this.state.username, dimension: this.state.dimension, snapshot: this.state })
    }
    this.emit('updated', { state: this.state, previous })
    return this.state
  }

  setActiveTask(task) {
    this.state = { ...this.state, activeTask: task ?? null }
    this.emit('updated', { state: this.state, previous: this.state })
  }

  start() {
    if (this.timer) return
    this.refresh()
    this.timer = setInterval(() => this.refresh(), this.intervalMs)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}
