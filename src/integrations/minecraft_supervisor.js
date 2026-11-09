import { EventEmitter } from 'node:events'
import { createMinecraftBot } from './minecraft.js'
import { logger } from '../utils/logger.js'

/**
 * Owns one Mineflayer connection and recreates it after an unexpected end.
 * Consumers receive every replacement through `bot` and `spawn` events.
 */
export class MinecraftSupervisor extends EventEmitter {
  constructor(config, onChat, { maxRetries = Infinity, baseDelayMs = 1000, maxDelayMs = 30000, botFactory = createMinecraftBot } = {}) {
    super()
    this.config = config
    this.onChat = onChat
    this.maxRetries = maxRetries
    this.baseDelayMs = baseDelayMs
    this.maxDelayMs = maxDelayMs
    this.botFactory = botFactory
    this.bot = null
    this.retryCount = 0
    this.timer = null
    this.stopped = false
    this.log = logger.child({ component: 'MinecraftSupervisor', username: config.username })
  }

  start() {
    this.stopped = false
    this.#connect()
    return this
  }

  stop(reason = 'Supervisor stopped') {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const bot = this.bot
    this.bot = null
    if (bot) {
      bot.removeListener('end', this.#onEnd)
      try { bot.quit(reason) } catch { /* connection may already be closed */ }
    }
  }

  #connect = () => {
    if (this.stopped) return
    this.log.info({ attempt: this.retryCount + 1 }, 'Connecting Minecraft bot')
    const bot = this.botFactory(this.config, this.onChat)
    this.bot = bot
    bot.on('spawn', () => {
      this.retryCount = 0
      this.emit('spawn', bot)
    })
    bot.on('end', this.#onEnd)
    this.emit('bot', bot)
  }

  #onEnd = () => {
    if (this.stopped) return
    this.bot = null
    this.retryCount += 1
    if (this.retryCount > this.maxRetries) {
      this.emit('exhausted')
      return
    }
    const delay = Math.min(this.maxDelayMs, this.baseDelayMs * (2 ** Math.max(0, this.retryCount - 1)))
    this.log.warn({ retryCount: this.retryCount, delay, pid: process.pid, username: this.config.username }, 'Minecraft disconnected; scheduling reconnect')
    this.emit('disconnect', { retryCount: this.retryCount, delay })
    this.timer = setTimeout(() => {
      this.timer = null
      this.#connect()
    }, delay)
  }
}
