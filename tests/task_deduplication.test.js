import test from 'node:test'
import assert from 'node:assert/strict'
import { AutonomousTaskExecutor } from '../src/tasks/task_executor.js'

test('autonomous duplicate instructions are not queued twice', async () => {
  const executor = new AutonomousTaskExecutor()
  const first = await executor.submitCommand('scan nearby environment', -10, 'NPCBehaviour')
  const second = await executor.submitCommand('scan nearby environment', -10, 'NPCBehaviour')
  assert.equal(second.id, first.id)
  assert.equal(executor.queue.length, 1)
  executor.emergencyStop()
})

test('autonomous controllers keep one focus when wording changes', async () => {
  const executor = new AutonomousTaskExecutor()
  const first = await executor.submitCommand('scan nearby environment', -10, 'Autonomy')
  const second = await executor.submitCommand('inspect current inventory', -10, 'CognitiveLoop')
  assert.equal(second.id, first.id)
  assert.equal(executor.queue.length, 1)
  executor.emergencyStop()
})
