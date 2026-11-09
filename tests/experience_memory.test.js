import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../src/database/memory_store.js'

test('MemoryStore separates typed verified experiences from assumptions', () => {
  const store = new MemoryStore(':memory:')
  store.recordExperience({ kind: 'semantic', content: 'A stone pickaxe can mine iron ore', verified: true, source: 'live-observation' })
  store.recordExperience({ kind: 'semantic', content: 'An unverified model guess', verified: false, source: 'model' })
  const verified = store.retrieveExperiences({ query: 'stone', kinds: ['semantic'], verifiedOnly: true })
  assert.equal(verified.length, 1)
  assert.match(verified[0].content, /stone pickaxe/)
})
