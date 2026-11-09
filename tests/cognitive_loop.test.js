import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { CognitiveLoop } from '../src/agents/cognitive_loop.js'
import { memoryStore } from '../src/database/memory_store.js'

test('CognitiveLoop reflects only after terminal task outcome', async () => {
  const executor = new EventEmitter()
  executor.submitCommand = async () => ({ id: 'cognitive-test-task', status: 'received', instruction: 'test objective' })
  const loop = new CognitiveLoop({
    bot: {},
    taskExecutor: executor,
    playerState: { refresh: () => ({ health: 20 }) },
  })
  const { plan, task } = await loop.run('inspect inventory')
  assert.equal(task.status, 'received')
  assert.equal(memoryStore.getTask(task.id), undefined)
  executor.emit('task:terminal', { task: { ...task, status: 'completed' }, status: 'completed' })
  const reflection = memoryStore.retrieveExperiences({ query: plan.instruction, limit: 5 })
  assert.ok(reflection.some(item => item.verified === 1 || item.verified === true))
})
