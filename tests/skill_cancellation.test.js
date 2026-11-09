import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { SkillExecutor } from '../src/skills/executor.js'

test('cancelled skills never request a retry', async () => {
  const bot = Object.assign(new EventEmitter(), { inventory: { items: () => [] } })
  const controller = new AbortController()
  controller.abort()
  const events = []
  const executor = new SkillExecutor({
    get: () => ({ id: 'cancel_test', requires: [], resources: [], timeout: 1000, execute: async () => ({ success: true }) }),
    has: () => true,
  })
  executor.on('skill:retry', (event) => events.push(event))
  const result = await executor.execute(bot, 'cancel_test', {}, { signal: controller.signal, maxRetries: 2 })
  assert.equal(result.success, false)
  assert.equal(result.error, 'Skill execution cancelled')
  assert.equal(events.length, 0)
})
