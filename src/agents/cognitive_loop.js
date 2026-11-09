import { randomUUID } from 'node:crypto'
import { taskPlanner } from '../tasks/task_planner.js'
import { memoryStore } from '../database/memory_store.js'
import { logger } from '../utils/logger.js'

const log = logger.child({ component: 'CognitiveLoop' })

/**
 * Thin perception/retrieval/planning/reflection layer around the existing
 * authoritative TaskExecutor. It never performs Mineflayer actions itself.
 */
export class CognitiveLoop {
  constructor({ bot, playerState, taskExecutor, now = Date.now } = {}) {
    this.bot = bot
    this.playerState = playerState
    this.taskExecutor = taskExecutor
    this.now = now
    this.pendingPlans = new Map()
    this.taskExecutor?.on?.('task:terminal', ({ task, status, error }) => {
      const plan = this.pendingPlans.get(task.id)
      if (!plan) return
      this.pendingPlans.delete(task.id)
      this.reflect(plan, { ...task, status, error })
    })
  }

  perceive() {
    return this.playerState?.refresh?.() ?? {
      health: this.bot?.health ?? null,
      food: this.bot?.food ?? null,
      position: this.bot?.entity?.position ?? null,
      timeOfDay: this.bot?.time?.timeOfDay ?? null,
    }
  }

  retrieve(instruction) {
    return memoryStore.retrieveExperiences({ query: instruction, verifiedOnly: true, limit: 8 })
  }

  plan(instruction, perception, memories) {
    const plan = taskPlanner.plan(instruction, 'Autonomy')
    return { id: `cognitive_${randomUUID()}`, instruction, perception, memories, plan, createdAt: this.now() }
  }

  async execute(cognitivePlan, priority = -10) {
    const task = await this.taskExecutor.submitCommand(cognitivePlan.instruction, priority, 'CognitiveLoop')
    cognitivePlan.taskId = task.id
    this.pendingPlans.set(task.id, cognitivePlan)
    return task
  }

  reflect(cognitivePlan, result) {
    const verified = result?.status === 'completed' || result?.status === 'COMPLETED'
    const terminalFailure = result?.status === 'failed' || result?.status === 'cancelled'
    memoryStore.recordExperience({
      kind: terminalFailure ? 'failure' : 'episodic',
      content: JSON.stringify({
        instruction: cognitivePlan.instruction,
        taskId: cognitivePlan.taskId,
        status: result?.status ?? 'submitted',
        planId: cognitivePlan.id,
        result: result?.results ?? null,
        error: result?.error ?? null,
      }),
      taskId: cognitivePlan.taskId,
      verified,
      source: 'cognitive-loop',
    })
    return { verified, taskId: cognitivePlan.taskId }
  }

  async run(instruction, priority = -10) {
    const perception = this.perceive()
    const memories = this.retrieve(instruction)
    const plan = this.plan(instruction, perception, memories)
    log.info({ planId: plan.id, instruction, memoryCount: memories.length }, 'Cognitive plan created')
    const task = await this.execute(plan, priority)
    return { plan, task }
  }
}
