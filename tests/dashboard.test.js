import test from 'node:test'
import assert from 'node:assert/strict'
import { createDashboard } from '../src/integrations/dashboard.js'
import http from 'node:http'

test('dashboard API starts on an ephemeral local port', async () => {
  const server = createDashboard({ port: 0, bot: {}, taskExecutor: {} })
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.equal(typeof address.port, 'number')
  await new Promise((resolve) => server.close(resolve))
})

test('dashboard resolves the current bot through a getter', async () => {
  const first = { username: 'old', entity: null }
  const current = { username: 'reconnected', entity: {} }
  let bot = first
  const server = createDashboard({ port: 0, getBot: () => bot, taskExecutor: {} })
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  const request = () => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${address.port}/health`, response => {
      let body = ''
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve(JSON.parse(body)))
    }).on('error', reject)
  })
  assert.equal((await request()).minecraftConnected, false)
  bot = current
  assert.equal((await request()).minecraftConnected, true)
  await new Promise((resolve) => server.close(resolve))
})
