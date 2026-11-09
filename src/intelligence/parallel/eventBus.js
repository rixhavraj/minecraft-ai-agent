import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

export const INTELLIGENCE_EVENTS = Object.freeze({
  WORLD_STATE_UPDATED: 'WORLD_STATE_UPDATED', THREAT_DETECTED: 'THREAT_DETECTED', THREAT_DISAPPEARED: 'THREAT_DISAPPEARED', HEALTH_CRITICAL: 'HEALTH_CRITICAL', HUNGER_LOW: 'HUNGER_LOW', TASK_PROGRESS_UPDATED: 'TASK_PROGRESS_UPDATED', TASK_STUCK: 'TASK_STUCK', TASK_COMPLETED: 'TASK_COMPLETED', TASK_FAILED: 'TASK_FAILED', STRATEGY_RECOMMENDATION: 'STRATEGY_RECOMMENDATION', NIGHT_APPROACHING: 'NIGHT_APPROACHING', SURVIVAL_RECOVERED: 'SURVIVAL_RECOVERED',
})

export class IntelligenceEventBus extends EventEmitter {
  publish(type, { priority = 3, worldStateVersion = null, taskId = null, payload = {} } = {}) {
    const event = { eventId: randomUUID(), type, priority, timestamp: new Date().toISOString(), worldStateVersion, taskId, payload }
    this.emit(type, event); this.emit('*', event); return event
  }
}
