import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../src/database/memory_store.js'

test('MemoryStore persists the authoritative action lifecycle', () => {
  const store = new MemoryStore(':memory:')
  const actionId = store.createAction({ taskId: 'task-1', skillId: 'collect_wood', args: { quantity: 4 } })
  assert.equal(store.getAction(actionId).status, 'PROPOSED')
  store.updateAction(actionId, 'VALIDATED')
  store.updateAction(actionId, 'APPROVED')
  store.updateAction(actionId, 'EXECUTING')
  const completed = store.updateAction(actionId, 'VERIFIED', { result: { collected: 4 } })
  assert.equal(completed.status, 'VERIFIED')
  assert.deepEqual(JSON.parse(completed.result_json), { collected: 4 })
})
