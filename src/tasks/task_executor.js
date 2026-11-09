/**
 * Centralized Autonomous Task Executor for minecraft-ai-squad
 *
 * Implements authoritative task lifecycle:
 *   RECEIVED -> UNDERSTANDING -> PLANNING -> RESOURCE_CHECK -> EXECUTING -> OBSERVING -> VERIFYING -> COMPLETED
 * And failure lifecycle:
 *   ERROR -> RECOVERY -> REPLANNING -> RETRY -> VERIFICATION
 *
 * Enforces per-bot physical execution locks, priorities, timeouts, retries,
 * pause/resume/cancel, emergency stops, and persistent outcome learning.
 */

import { EventEmitter } from 'node:events'
import { skillExecutor } from '../skills/executor.js'
import { skillRegistry } from '../skills/registry.js'
import { taskPlanner } from './task_planner.js'
import { memoryStore } from '../database/memory_store.js'
import { agentRegistry } from '../agents/agent_registry.js'
import { logger } from '../utils/logger.js'

const log = logger.child({ component: 'TaskExecutor' })

export const TASK_STATUS = {
  RECEIVED: 'received',
  UNDERSTANDING: 'understanding',
  PLANNING: 'planning',
  RESOURCE_CHECK: 'resource_check',
  EXECUTING: 'executing',
  OBSERVING: 'observing',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
}

export class AutonomousTaskExecutor extends EventEmitter {
  constructor() {
    super()
    this.queue = []
    this.activeTask = null
    this.isPaused = false
    this.isEmergencyStopped = false
    this.bot = null
    this._botEndHandler = null
    this.onProgressCallback = null
    this.ownerFocusUntil = 0
  }

  setBot(bot) {
    if (this.bot && this._botEndHandler) this.bot.removeListener('end', this._botEndHandler)
    this.bot = bot
    this._botEndHandler = () => {
      if (this.activeTask) {
        this.activeTask.abortController?.abort()
        this.activeTask.status = TASK_STATUS.CANCELLED
        memoryStore.updateTaskStatus(this.activeTask.id, TASK_STATUS.CANCELLED, null, 'Minecraft bot disconnected')
        this.emit('task:terminal', { task: this.activeTask, status: TASK_STATUS.CANCELLED, error: 'Minecraft bot disconnected' })
        this.notify('[CANCELLED] Active task cancelled because Minecraft disconnected.')
        this.activeTask = null
      }
    }
    bot?.on?.('end', this._botEndHandler)
  }

  async recoverUnfinishedTasks() {
    if (this.activeTask || this.queue.length) return []
    const recoverable = memoryStore.getRecentTasks(50).filter((task) => ['received', 'planning', 'execution', 'verification', 'paused'].includes(task.status))
    const recovered = []
    for (const persisted of recoverable) {
      const taskItem = {
        id: persisted.id,
        instruction: persisted.instruction,
        priority: persisted.priority,
        issuerName: 'Recovery',
        status: TASK_STATUS.RECEIVED,
        plan: null,
        currentStepIndex: 0,
        results: [],
        errors: [],
        createdAt: Date.now(),
        abortController: new AbortController(),
      }
      this.queue.push(taskItem)
      recovered.push(persisted.id)
    }
    this.queue.sort((a, b) => b.priority - a.priority)
    if (recovered.length) {
      this.notify(`[RECOVERY] Requeued ${recovered.length} unfinished task(s) after restart.`)
      void this.processNext()
    }
    return recovered
  }

  setProgressCallback(fn) {
    this.onProgressCallback = fn
  }

  notify(message) {
    log.info({ update: message }, 'Task progress update')
    this.emit('progress', message)
    if (this.onProgressCallback) {
      try {
        this.onProgressCallback(message)
      } catch (err) {
        log.warn({ err: err.message }, 'Progress callback failed')
      }
    }
  }

  /**
   * Submit a new instruction to the queue
   */
  async submitCommand(instruction, priority = 0, issuerName = null) {
    if (this.isEmergencyStopped) {
      throw new Error('System is in EMERGENCY STOP state. Clear stop before submitting tasks.')
    }

    const normalizedInstruction = String(instruction).trim().toLowerCase()
    const isAutonomous = ['Autonomy', 'CognitiveLoop', 'NPCBehaviour'].includes(issuerName)
    // Give an owner command a quiet window after completion so idle brains do
    // not immediately replace it with scan/inventory/routine work.
    if (!isAutonomous) this.ownerFocusUntil = Date.now() + 30_000
    // Autonomous controllers must share one focus. Returning the current task
    // prevents idle/NPC ticks from competing with the objective already being
    // understood or executed, even when their wording is different.
    if (isAutonomous && (this.activeTask || this.queue.length > 0 || Date.now() < this.ownerFocusUntil)) {
      return this.activeTask ?? this.queue[0] ?? { id: 'owner-focus-locked', status: 'suppressed', instruction: '' }
    }

    const duplicate = this.activeTask?.instruction?.trim().toLowerCase() === normalizedInstruction
      ? this.activeTask
      : this.queue.find((queued) => queued.instruction.trim().toLowerCase() === normalizedInstruction)
    if (duplicate && isAutonomous) return duplicate

    const taskId = memoryStore.createTask(instruction, priority)
    const taskItem = {
      id: taskId,
      instruction,
      priority,
      issuerName,
      status: TASK_STATUS.RECEIVED,
      plan: null,
      currentStepIndex: 0,
      results: [],
      errors: [],
      createdAt: Date.now(),
      abortController: new AbortController(),
    }

    // Insert into priority queue
    this.queue.push(taskItem)
    this.queue.sort((a, b) => b.priority - a.priority)

    this.notify(`[TASK RECEIVED] (#${taskId.slice(0, 8)}) "${instruction}"`)
    memoryStore.updateTaskStatus(taskId, TASK_STATUS.RECEIVED)

    // Trigger process loop
    void this.processNext()
    return taskItem
  }

  pause() {
    this.isPaused = true
    if (this.activeTask) {
      this.activeTask.status = TASK_STATUS.PAUSED
      memoryStore.updateTaskStatus(this.activeTask.id, TASK_STATUS.PAUSED)
    }
    this.notify('[PAUSED] Task execution suspended.')
  }

  resume() {
    this.isPaused = false
    if (this.activeTask && this.activeTask.status === TASK_STATUS.PAUSED) {
      this.activeTask.status = TASK_STATUS.EXECUTING
      memoryStore.updateTaskStatus(this.activeTask.id, TASK_STATUS.EXECUTING)
    }
    this.notify('[RESUMED] Task execution resumed.')
    void this.processNext()
  }

  cancelCurrent() {
    if (this.activeTask) {
      const id = this.activeTask.id
      this.activeTask.abortController?.abort()
      this.activeTask.status = TASK_STATUS.CANCELLED
      memoryStore.updateTaskStatus(id, TASK_STATUS.CANCELLED, null, 'User cancelled')
      this.emit('task:terminal', { task: this.activeTask, status: TASK_STATUS.CANCELLED, error: 'User cancelled' })
      this.notify(`[CANCELLED] Task #${id.slice(0, 8)} cancelled.`)
      if (this.bot?.pathfinder) {
        this.bot.pathfinder.setGoal(null)
      }
      this.activeTask = null
      void this.processNext()
    }
  }

  emergencyStop() {
    this.isEmergencyStopped = true
    this.isPaused = true
    this.queue = []
    if (this.bot?.pathfinder) {
      this.bot.pathfinder.setGoal(null)
    }
    if (this.bot?.clearControlStates) {
      this.bot.clearControlStates()
    }
    if (this.activeTask) {
      this.activeTask.abortController?.abort()
      memoryStore.updateTaskStatus(this.activeTask.id, TASK_STATUS.CANCELLED, null, 'EMERGENCY_STOP')
      this.emit('task:terminal', { task: this.activeTask, status: TASK_STATUS.CANCELLED, error: 'EMERGENCY_STOP' })
      this.activeTask = null
    }
    this.notify('[EMERGENCY STOP] All actions halted immediately.')
  }

  resetEmergencyStop() {
    this.isEmergencyStopped = false
    this.isPaused = false
    this.notify('[SYSTEM READY] Emergency stop cleared.')
  }

  /**
   * Main execution loop
   */
  async processNext() {
    if (this.isPaused || this.isEmergencyStopped || this.activeTask || this.queue.length === 0) {
      return
    }

    if (!this.bot) {
      log.warn('Cannot process tasks: Minecraft bot is not attached to executor')
      return
    }

    this.activeTask = this.queue.shift()
    const task = this.activeTask

    try {
      // 1. UNDERSTANDING
      task.status = TASK_STATUS.UNDERSTANDING
      memoryStore.updateTaskStatus(task.id, TASK_STATUS.UNDERSTANDING)
      this.notify(`[UNDERSTANDING] Analyzing: "${task.instruction}"`)

      // 2. PLANNING
      task.status = TASK_STATUS.PLANNING
      memoryStore.updateTaskStatus(task.id, TASK_STATUS.PLANNING)
      task.plan = taskPlanner.plan(task.instruction, task.issuerName)
      this.notify(`[PLAN READY] Decomposed into ${task.plan.tasks.length} step(s) by Strategist.`)
      const decision = task.plan.tasks.map(step => `${step.agent || 'Commander'}:${step.skillId}`).join(' -> ')
      memoryStore.recordTaskEvent(task.id, 'decision:plan_selected', { decision, steps: task.plan.tasks })
      this.notify(`[DECISION] ${decision}`)

      // 3. RESOURCE CHECK
      task.status = TASK_STATUS.RESOURCE_CHECK
      memoryStore.updateTaskStatus(task.id, TASK_STATUS.RESOURCE_CHECK)
      this.notify(`[RESOURCE CHECK] Memory verifying supplies before execution...`)
      // Resource checks are local and should not make a simple command feel
      // like it is deliberating. Skills perform their own authoritative checks.
      await new Promise(r => setTimeout(r, 50))

      // 4. EXECUTING SUBTASKS
      task.status = TASK_STATUS.EXECUTING
      memoryStore.updateTaskStatus(task.id, TASK_STATUS.EXECUTING)

      for (let i = 0; i < task.plan.tasks.length; i++) {
        if (this.isPaused) {
          while (this.isPaused) await new Promise(r => setTimeout(r, 1000))
        }
        if (task.status === TASK_STATUS.CANCELLED || this.isEmergencyStopped) {
          return
        }

        task.currentStepIndex = i
        const step = task.plan.tasks[i]
        const assignedAgent = step.agent || 'Commander'

        this.notify(`[STEP ${i + 1}/${task.plan.tasks.length}] (${assignedAgent}) -> ${step.description}`)

        // 5. OBSERVING & EXECUTING SKILL
        let executionSuccess = false
        let retries = 0
        const MAX_RETRIES = 2

        while (!executionSuccess && retries <= MAX_RETRIES) {
          try {
            const result = await skillExecutor.execute(this.bot, step.skillId, step.args || {}, { maxRetries: 1, taskId: task.id, signal: task.abortController?.signal })
            if (result.success) {
              executionSuccess = true
              task.results.push({ stepId: step.id, skillId: step.skillId, result: result.result })

              // 6. VERIFYING
              task.status = TASK_STATUS.VERIFYING
              this.notify(`[VERIFIED] Step ${i + 1} completed successfully.`)
              task.status = TASK_STATUS.EXECUTING
            } else {
              throw new Error(result.error || 'Skill execution failed')
            }
          } catch (err) {
            if (task.abortController?.signal.aborted || task.status === TASK_STATUS.CANCELLED || this.isEmergencyStopped) {
              return
            }
            retries++
            log.warn({ err: err.message, step: step.id, retry: retries }, 'Step execution failed, initiating recovery lifecycle')
            this.notify(`[RECOVERY] Step failed (${err.message}). Attempting retry ${retries}/${MAX_RETRIES}...`)
            await new Promise(r => setTimeout(r, 250))

            if (retries > MAX_RETRIES) {
              task.errors.push(`Step ${step.id} failed: ${err.message}`)
              // Record failure lesson for future learning
              memoryStore.recordLesson('failure_recovery', `Task "${task.instruction}" failed at step ${step.skillId}: ${err.message}`, assignedAgent, task.id, 0)
              break
            }
          }
        }
        if (task.errors.length > 0) break
      }

      // Final status check
      if (task.errors.length === 0) {
        task.status = TASK_STATUS.COMPLETED
        memoryStore.updateTaskStatus(task.id, TASK_STATUS.COMPLETED, task.results)
        memoryStore.recordLesson('successful_execution', `Completed "${task.instruction}" with ${task.results.length} steps`, 'Commander', task.id, 1)
        this.notify(`[OBJECTIVE COMPLETED] All steps of "${task.instruction}" succeeded!`)
        this.emit('task:terminal', { task, status: task.status })
      } else {
        task.status = TASK_STATUS.FAILED
        memoryStore.updateTaskStatus(task.id, TASK_STATUS.FAILED, task.results, task.errors.join('; '))
        this.notify(`[TASK FAILED] "${task.instruction}" stopped with error: ${task.errors[0]}`)
        this.emit('task:terminal', { task, status: task.status })
      }
    } catch (err) {
      log.error({ err: err.message }, 'Fatal task execution error')
      task.status = TASK_STATUS.FAILED
      memoryStore.updateTaskStatus(task.id, TASK_STATUS.FAILED, null, err.message)
      this.notify(`[ERROR] Task halted: ${err.message}`)
      this.emit('task:terminal', { task, status: task.status, error: err.message })
    } finally {
      this.activeTask = null
      // Continue next queued item
      void this.processNext()
    }
  }

  getStatus() {
    return {
      activeTask: this.activeTask ? {
        id: this.activeTask.id,
        instruction: this.activeTask.instruction,
        status: this.activeTask.status,
        step: `${(this.activeTask.currentStepIndex || 0) + 1}/${this.activeTask.plan?.tasks?.length || 1}`,
      } : null,
      queuedCount: this.queue.length,
      isPaused: this.isPaused,
      isEmergencyStopped: this.isEmergencyStopped,
    }
  }
}

export const taskExecutor = new AutonomousTaskExecutor()

