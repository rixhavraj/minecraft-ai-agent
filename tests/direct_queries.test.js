import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchCommand } from '../src/integrations/command_dispatcher.js'

test('inventory questions return local verified state immediately', async () => {
  const bot = { inventory: { items: () => [{ name: 'oak_log', count: 4 }, { name: 'bread', count: 2 }] }, health: 20, food: 18 }
  const reply = await dispatchCommand("what's on your inventory", { bot })
  assert.match(reply, /oak_log x4/)
  assert.match(reply, /bread x2/)
  assert.match(reply, /Total items: 6/)
})

test('health questions return local verified state immediately', async () => {
  const reply = await dispatchCommand('what is your health', { bot: { health: 14, food: 12 } })
  assert.equal(reply, 'Verified vitals: health 14/20, hunger 12/20.')
})
