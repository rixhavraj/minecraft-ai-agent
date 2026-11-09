import { IntelligenceEventBus } from './eventBus.js'
import { ObservationCoordinator } from './observationCoordinator.js'

export class ParallelOrchestrator {
  constructor({ worldState, intervalMs = 1000, monitors = [], eventBus = new IntelligenceEventBus() } = {}) { this.eventBus=eventBus; this.observations=new ObservationCoordinator({worldState,eventBus,intervalMs,monitors}) }
  start() { this.observations.start(); return this }
  stop() { this.observations.stop() }
  addMonitor(monitor) { this.observations.addMonitor(monitor); return this }
}
