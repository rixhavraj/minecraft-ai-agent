import { EventEmitter } from 'node:events'

const HOSTILES = new Set(['blaze', 'cave_spider', 'creeper', 'drowned', 'enderman', 'evoker', 'ghast', 'guardian', 'hoglin', 'husk', 'magma_cube', 'phantom', 'piglin_brute', 'pillager', 'ravager', 'skeleton', 'spider', 'vex', 'vindicator', 'warden', 'witch', 'wither_skeleton', 'zoglin', 'zombie', 'zombie_villager'])

const distance = (a, b) => a && b ? Number(a.distanceTo(b).toFixed(2)) : null

export class EntityPerceptionController extends EventEmitter {
  constructor(bot, { intervalMs = 500, radius = 32, now = Date.now } = {}) {
    super(); this.bot = bot; this.intervalMs = intervalMs; this.radius = radius; this.now = now; this.state = this.snapshot(); this.timer = null
  }
  snapshot() {
    const position = this.bot.entity?.position ?? null
    const entities = Object.values(this.bot.entities ?? {}).filter((e) => e.position && (!position || distance(position, e.position) <= this.radius)).map((e) => ({
      id: e.id, name: e.name ?? null, type: e.type ?? null, position: { x: e.position.x, y: e.position.y, z: e.position.z }, distance: distance(position, e.position), health: e.health ?? null, hostile: HOSTILES.has(e.name), velocity: e.velocity ? { x: e.velocity.x, y: e.velocity.y, z: e.velocity.z } : null,
    }))
    return { observedAt: new Date(this.now()).toISOString(), position, health: this.bot.health ?? null, hunger: this.bot.food ?? null, equipment: (this.bot.inventory?.slots ?? []).slice(5, 9).map((i) => i?.name ?? null), inventory: (this.bot.inventory?.items?.() ?? []).reduce((a, i) => { a[i.name] = (a[i.name] ?? 0) + i.count; return a }, {}), timeOfDay: this.bot.time?.timeOfDay ?? null, dimension: this.bot.game?.dimension ?? null, entities, hostiles: entities.filter((e) => e.hostile) }
  }
  refresh() { const previous = this.state; this.state = this.snapshot(); this.emit('updated', { state: this.state, previous }); return this.state }
  start() { if (!this.timer) { this.refresh(); this.timer = setInterval(() => this.refresh(), this.intervalMs); this.timer.unref?.() } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
}
