import { EventEmitter } from 'node:events'
import { skillRegistry } from './registry.js'
import { createSkillContext } from './context.js'
import { logger } from '../utils/logger.js'
import { memoryStore } from '../database/memory_store.js'

/**
 * Per-bot mutex that ensures only one physical action runs at a time.
 * Backed by a simple async queue implemented with Promises.
 */
class BotMutex {
  constructor() {
    this._locked = false
    /** @type {{ resolve: () => void }[]} */
    this._queue = []
  }

  /**
   * Acquire the lock.  Resolves immediately if unlocked,
   * otherwise waits in a FIFO queue until released.
   *
   * @returns {Promise<void>}
   */
  acquire() {
    if (!this._locked) {
      this._locked = true
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this._queue.push({ resolve })
    })
  }

  /**
   * Release the lock, unblocking the next waiter if any.
   */
  release() {
    const next = this._queue.shift()
    if (next) {
      // Transfer ownership to the next waiter without toggling _locked
      next.resolve()
    } else {
      this._locked = false
    }
  }
}

/**
 * Centralized execution engine for skills.
 *
 * Handles lookup, argument validation, dependency checking,
 * per-bot locking, timeout protection, retry logic, verification,
 * and error recovery.
 *
 * Emits events:
 *  - 'skill:start'    { skillId, args, attempt }
 *  - 'skill:complete' { skillId, result, duration, retries }
 *  - 'skill:error'    { skillId, error, attempt, willRetry }
 *  - 'skill:retry'    { skillId, attempt, maxRetries, error }
 */
class SkillExecutor extends EventEmitter {
  constructor(registry = skillRegistry) {
    super()
    this._registry = registry
    this._mutexes = new WeakMap()
    this._log = logger.child({ component: 'SkillExecutor' })
    this._stats = new Map()
  }

  /**
   * Get (or create) the per-bot mutex.
   *
   * @param {import('mineflayer').Bot} bot
   * @returns {BotMutex}
   */
  _getMutex(bot) {
    let mutex = this._mutexes.get(bot)
    if (!mutex) {
      mutex = new BotMutex()
      this._mutexes.set(bot, mutex)
    }
    return mutex
  }

  /**
   * Execute a registered skill.
   *
   * @param {import('mineflayer').Bot} bot       The bot to act with.
   * @param {string}                  skillId   Registered skill id.
   * @param {object}                  [args={}] Arguments passed to the skill.
   * @param {object}                  [options]
   * @param {number}                  [options.maxRetries=2]  Total retries on failure.
   * @param {number}                  [options.timeoutMs]     Override default timeout.
   * @returns {Promise<{ success: boolean, skillId: string, result: any, duration: number, retries: number, error: string|null }>}
   */
  async execute(bot, skillId, args = {}, options = {}) {
    const skill = this._registry.get(skillId)
    if (!skill) {
      return this._failure(skillId, `Skill "${skillId}" is not registered`, 0, 0)
    }

    // Check dependencies are registered (they must exist for the system to be complete)
    for (const depId of skill.requires) {
      if (!this._registry.has(depId)) {
        return this._failure(skillId, `Missing dependency skill "${depId}"`, 0, 0)
      }
    }

    const maxRetries = options.maxRetries ?? 2
    const timeoutMs = options.timeoutMs ?? skill.timeout
    const actionId = memoryStore.createAction({ taskId: options.taskId ?? null, skillId, args })
    memoryStore.updateAction(actionId, 'VALIDATED')
    memoryStore.updateAction(actionId, 'APPROVED')

    const inventory = bot?.inventory?.items?.() ?? []
    const missingResources = skill.resources
      .map(({ item, quantity }) => ({ item, required: quantity, available: inventory.filter(entry => entry.name === item).reduce((sum, entry) => sum + entry.count, 0) }))
      .filter(({ available, required }) => available < required)
    if (missingResources.length) {
      const error = `Missing declared resources: ${missingResources.map(({ item, required, available }) => `${item} (${available}/${required})`).join(', ')}`
      memoryStore.updateAction(actionId, 'FAILED', { error })
      return this._failure(skillId, error, 0, 0, 'MISSING_RESOURCE')
    }
    // Do not construct a Mineflayer/pathfinder context for an already-cancelled
    // action. This also makes cancellation safe during disconnect teardown.
    if (options.signal?.aborted) {
      memoryStore.updateAction(actionId, 'CANCELLED', { error: 'Skill execution cancelled' })
      return this._failure(skillId, 'Skill execution cancelled', 0, 0, 'CANCELLED')
    }
    const context = createSkillContext(bot, skillId)
    const mutex = this._getMutex(bot)

    let lastError = null
    let attempt = 0
    const overallStart = Date.now()

    if (skill.precondition) {
      const precondition = await skill.precondition(bot, args, context)
      if (precondition === false || precondition?.valid === false) {
        memoryStore.updateAction(actionId, 'FAILED', { error: precondition?.reason ?? 'Skill precondition failed' })
        return this._failure(skillId, precondition?.reason ?? 'Skill precondition failed', 0, 0, 'PRECONDITION_FAILED')
      }
    }

    for (attempt = 0; attempt <= maxRetries; attempt++) {
      // Wait for exclusive access
      await mutex.acquire()

      try {
        if (options.signal?.aborted) throw this._cancelledError()
        memoryStore.updateAction(actionId, 'EXECUTING')
        this.emit('skill:start', { skillId, args, attempt })
        this._log.info({ skillId, attempt }, 'Executing skill')

        // Execute with timeout protection
        const result = await this._withTimeout(
          skill.execute(bot, args, context),
          timeoutMs,
          skillId,
          options.signal,
        )

        if (result && typeof result === 'object' && result.success === false) {
          throw new Error(result.error || result.message || `Skill "${skillId}" returned failure`)
        }

        // Verify if a verify function is provided
        if (skill.verify) {
          const verifyResult = await this._withTimeout(
            skill.verify(bot, args, result),
            Math.min(timeoutMs, 15_000),
            `${skillId}:verify`,
          )
          const isValid = typeof verifyResult === 'boolean'
            ? verifyResult
            : (verifyResult?.valid ?? verifyResult?.verified ?? true)

          if (!isValid) {
            const verifyError = new Error(`Skill "${skillId}" executed but verification failed: ${verifyResult?.reason || 'unverified'}`)
            verifyError.code = 'VERIFY_FAILED'
            throw verifyError
          }
        }

        const duration = Date.now() - overallStart
        this.emit('skill:complete', { skillId, result, duration, retries: attempt })
        this._recordStat(skillId, true, duration)
        memoryStore.updateAction(actionId, 'VERIFIED', { result })
        this._log.info({ skillId, duration, retries: attempt }, 'Skill completed')

        return {
          success: true,
          skillId,
          result,
          duration,
          retries: attempt,
          error: null,
        }
      } catch (error) {
        lastError = error
        // Cancellation and disconnects are terminal. Retrying here can execute
        // stale actions after the bot has left the world.
        const cancelled = error.code === 'CANCELLED' || options.signal?.aborted
        const willRetry = !cancelled && attempt < maxRetries
        this.emit('skill:error', { skillId, error, attempt, willRetry })
        this._log.warn(
          { skillId, err: error, attempt, willRetry },
          'Skill execution failed',
        )
        if (cancelled) {
          this._recordStat(skillId, false, Date.now() - overallStart)
          memoryStore.updateAction(actionId, 'CANCELLED', { error: error.message })
          return this._failure(skillId, error.message, Date.now() - overallStart, attempt, 'CANCELLED')
        }

        // Attempt recovery
        if (skill.recover) {
          try {
            await this._withTimeout(
              skill.recover(bot, args, error),
              Math.min(timeoutMs, 10_000),
              `${skillId}:recover`,
            )
          } catch (recoverError) {
            this._log.warn(
              { skillId, err: recoverError },
              'Skill recovery handler also failed',
            )
          }
        }

        if (willRetry) {
          this.emit('skill:retry', { skillId, attempt: attempt + 1, maxRetries, error })
          this._log.info({ skillId, nextAttempt: attempt + 1 }, 'Retrying skill')
          // Brief pause before retry to let the world settle
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      } finally {
        mutex.release()
      }
    }

    // All attempts exhausted
    const duration = Date.now() - overallStart
    this._recordStat(skillId, false, duration)
    memoryStore.updateAction(actionId, 'FAILED', { error: lastError?.message ?? 'Unknown error' })
    return this._failure(skillId, lastError?.message ?? 'Unknown error', duration, attempt, this._classifyFailure(lastError))
  }

  /**
   * Wrap a promise with a timeout.
   *
   * @param {Promise} promise
   * @param {number}  ms
   * @param {string}  label      For error messages.
   * @returns {Promise}
   */
  _withTimeout(promise, ms, label, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(this._cancelledError())
      const timer = setTimeout(() => {
        reject(new Error(`Skill "${label}" timed out after ${ms}ms`))
      }, ms)
      const onAbort = () => { clearTimeout(timer); reject(this._cancelledError()) }
      signal?.addEventListener('abort', onAbort, { once: true })

      Promise.resolve(promise).then(
        (value) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(value) },
        (error) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(error) },
      )
    })
  }

  _cancelledError() {
    const error = new Error('Skill execution cancelled')
    error.code = 'CANCELLED'
    return error
  }

  _classifyFailure(error) {
    if (error?.code === 'VERIFY_FAILED') return 'VERIFICATION_FAILED'
    if (/timed out/i.test(error?.message ?? '')) return 'TIMEOUT'
    if (/missing|no .*found|insufficient|needs/i.test(error?.message ?? '')) return 'MISSING_RESOURCE'
    if (/path|navigate|goal/i.test(error?.message ?? '')) return 'NAVIGATION_FAILED'
    return 'EXECUTION_FAILED'
  }

  _recordStat(skillId, success, duration) {
    const current = this._stats.get(skillId) ?? { attempts: 0, successes: 0, failures: 0, totalDurationMs: 0 }
    current.attempts++
    current.totalDurationMs += duration
    if (success) current.successes++
    else current.failures++
    this._stats.set(skillId, current)
    memoryStore.recordSkillStat(skillId, success, duration)
  }

  getStats(skillId = null) {
    if (skillId) {
      const stat = this._stats.get(skillId)
      return stat ? { ...stat, successRate: stat.successes / stat.attempts } : null
    }
    return Object.fromEntries([...this._stats].map(([id, stat]) => [id, { ...stat, successRate: stat.successes / stat.attempts }]))
  }

  /**
   * Build a failure result object.
   *
   * @param {string} skillId
   * @param {string} errorMessage
   * @param {number} duration
   * @param {number} retries
   * @returns {{ success: boolean, skillId: string, result: null, duration: number, retries: number, error: string }}
   */
  _failure(skillId, errorMessage, duration, retries, failureClass = 'EXECUTION_FAILED') {
    return {
      success: false,
      skillId,
      result: null,
      duration,
      retries,
      error: errorMessage,
      failureClass,
    }
  }
}

/** Singleton skill executor shared across the application. */
export const skillExecutor = new SkillExecutor()

export { SkillExecutor, BotMutex }
