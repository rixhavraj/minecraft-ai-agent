import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../src/database/memory_store.js'

test('MemoryStore persists hierarchical goal progress and conditions', () => {
  const store = new MemoryStore(':memory:')
  const parent = store.createGoal({ title: 'Survival base', completion: { shelter: true } })
  const child = store.createGoal({ title: 'Collect wood', parentId: parent, dependencies: ['spawn_observed'] })
  store.updateGoal(child, { progress: 0.5 })
  const goal = store.getGoals().find((item) => item.id === child)
  assert.equal(goal.parent_id, parent)
  assert.equal(goal.progress, 0.5)
  assert.deepEqual(goal.dependencies, ['spawn_observed'])
})
