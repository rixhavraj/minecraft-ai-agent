import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../src/database/memory_store.js'
import { BenchmarkRunner } from '../src/evaluation/benchmark.js'
import { memoryStore as liveStore } from '../src/database/memory_store.js'

test('benchmark receipts persist mode and measured metrics', () => {
  const store = new MemoryStore(':memory:')
  const id = store.createBenchmarkRun({ label: 'unit smoke', mode: 'simulated', provider: 'ollama', model: 'test', seed: '1' })
  store.completeBenchmarkRun(id, { success: true, durationMs: 123 })
  const run = store.getBenchmarkRuns()[0]
  assert.equal(run.mode, 'simulated')
  assert.equal(run.metrics.durationMs, 123)
})

test('BenchmarkRunner records the real task terminal status', async () => {
  const executor = {
    async submitCommand(instruction) {
      const id = liveStore.createTask(instruction)
      liveStore.updateTaskStatus(id, 'completed', { verified: true })
      return { id }
    },
  }
  const result = await new BenchmarkRunner({ executor, pollMs: 1 }).run({
    label: 'runner smoke', instruction: 'inspect inventory', mode: 'simulated', timeoutMs: 1000,
  })
  assert.equal(result.success, true)
  assert.equal(result.status, 'completed')
  assert.equal(result.timedOut, false)
})
