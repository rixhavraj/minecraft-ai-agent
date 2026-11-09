import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { MinecraftSupervisor } from '../src/integrations/minecraft_supervisor.js'

test('MinecraftSupervisor reconnects with bounded exponential backoff', async () => {
  const bots = []
  const supervisor = new MinecraftSupervisor({ username: 'test' }, () => {}, {
    baseDelayMs: 1,
    maxDelayMs: 2,
    maxRetries: 1,
    botFactory: () => {
      const bot = new EventEmitter()
      bot.quit = () => {}
      bots.push(bot)
      return bot
    },
  }).start()

  assert.equal(bots.length, 1)
  bots[0].emit('end')
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(bots.length, 2)
  supervisor.stop()
})
