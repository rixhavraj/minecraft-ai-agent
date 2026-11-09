import { memoryStore } from '../database/memory_store.js'
import { taskExecutor as defaultTaskExecutor } from '../tasks/task_executor.js'

export class BenchmarkRun {
  constructor(config) {
    this.id = memoryStore.createBenchmarkRun(config)
    this.startedAt = Date.now()
  }

  complete(metrics) {
    const result = { ...metrics, durationMs: metrics.durationMs ?? Date.now() - this.startedAt }
    memoryStore.completeBenchmarkRun(this.id, result)
    return result
  }
}

/**
 * Executes one reproducible task receipt through the real task manager.
 * The runner records measurements only; it never converts a timeout into success.
 */
export class BenchmarkRunner {
  constructor({ executor = defaultTaskExecutor, pollMs = 250 } = {}) {
    this.executor = executor
    this.pollMs = pollMs
  }

  async run({ label, instruction, mode = 'live', provider = null, model = null, seed = null, priority = -100, timeoutMs = 10 * 60 * 1000 }) {
    const run = new BenchmarkRun({ label, mode, provider, model, seed })
    const startedAt = Date.now()
    let taskId = null
    try {
      const task = await this.executor.submitCommand(instruction, priority, 'BenchmarkRunner')
      taskId = task.id
      const deadline = startedAt + timeoutMs
      let persisted
      while (Date.now() < deadline) {
        persisted = memoryStore.getTask(taskId)
        if (['completed', 'failed', 'cancelled'].includes(persisted?.status)) break
        await new Promise((resolve) => setTimeout(resolve, this.pollMs))
      }
      persisted = memoryStore.getTask(taskId)
      const timedOut = !persisted || !['completed', 'failed', 'cancelled'].includes(persisted.status)
      if (timedOut) this.executor.cancelCurrent?.()
      const metrics = {
        success: persisted?.status === 'completed',
        status: timedOut ? 'timeout' : persisted.status,
        taskId,
        durationMs: Date.now() - startedAt,
        timedOut,
      }
      return { runId: run.id, ...run.complete(metrics) }
    } catch (error) {
      return { runId: run.id, ...run.complete({ success: false, status: 'runner_error', taskId, error: error.message, durationMs: Date.now() - startedAt }) }
    }
  }
}
