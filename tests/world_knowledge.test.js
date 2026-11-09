import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../src/database/memory_store.js'

test('MemoryStore persists world observations and resource reservations', () => {
  const store = new MemoryStore(':memory:')
  store.recordWorldObservation({ worldId: 'test-world', discoveryType: 'village', x: 1, y: 64, z: 2, details: { source: 'scan' }, confidence: 0.8 })
  assert.equal(store.getWorldObservations({ worldId: 'test-world' })[0].details.source, 'scan')
  const taskId = store.createTask('test reservation')
  const reservation = store.reserveResource(taskId, 'iron_ingot', 3)
  assert.equal(store.getResourceReservations()[0].quantity, 3)
  const secondTask = store.createTask('conflicting reservation')
  assert.throws(() => store.reserveResource(secondTask, 'iron_ingot', 1), /already reserved/)
  store.releaseResourceReservation(reservation.id)
  assert.equal(store.getResourceReservations().length, 0)
})

test('MemoryStore persists provider latency and token telemetry', () => {
  const store = new MemoryStore(':memory:')
  store.recordModelCall({ provider: 'ollama', model: 'test', status: 'completed', latencyMs: 42, usage: { inputTokens: 10, outputTokens: 4 } })
  const call = store.getRecentModelCalls()[0]
  assert.equal(call.provider, 'ollama')
  assert.equal(call.latency_ms, 42)
  assert.equal(call.input_tokens, 10)
  assert.equal(call.output_tokens, 4)
})

test('MemoryStore persists skill performance aggregates', () => {
  const store = new MemoryStore(':memory:')
  store.recordSkillStat('scan_nearby', true, 100)
  store.recordSkillStat('scan_nearby', false, 300)
  const stat = store.getSkillStats()[0]
  assert.equal(stat.attempts, 2)
  assert.equal(stat.successes, 1)
  assert.equal(stat.failures, 1)
  assert.equal(stat.average_duration_ms, 200)
})

test('MemoryStore persists latest world session snapshots', () => {
  const store = new MemoryStore(':memory:')
  store.upsertWorldSession({ worldId: 'world-a', username: 'Agent001', dimension: 'overworld', snapshot: { health: 20, food: 20 } })
  store.upsertWorldSession({ worldId: 'world-a', username: 'Agent001', dimension: 'the_nether', snapshot: { health: 18, food: 16 } })
  const sessions = store.getWorldSessions()
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].dimension, 'the_nether')
  assert.equal(sessions[0].snapshot.health, 18)
})
