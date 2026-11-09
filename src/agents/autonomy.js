import { logger } from '../utils/logger.js'

const log = logger.child({ component: 'AutonomyController' })

/** Opt-in idle controller. User tasks always remain higher priority. */
export class AutonomyController {
  constructor(bot, taskExecutor, { intervalMs = 5000, now = Date.now } = {}) {
    this.bot = bot
    this.taskExecutor = taskExecutor
    this.intervalMs = intervalMs
    this.now = now
    this.timer = undefined
    this.lastActionAt = 0
    this.cognitiveLoop = null
  }

  setCognitiveLoop(cognitiveLoop) {
    this.cognitiveLoop = cognitiveLoop
  }

  start() {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => { void this.tick() }, this.intervalMs)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async tick() {
    if (!this.bot.entity || this.taskExecutor.isPaused || this.taskExecutor.isEmergencyStopped || this.taskExecutor.activeTask || this.taskExecutor.queue?.length) return
    if (this.now() - this.lastActionAt < this.intervalMs) return
    const time = this.bot.time?.timeOfDay ?? 0
    const hunger = this.bot.food ?? 20
    const health = this.bot.health ?? 20
    let instruction = null
    // SurvivalController owns emergency response. Do not enqueue repeated
    // low-health objectives here or starve user tasks with an emergency loop.
    if (health <= 8) return
    else if (hunger <= 10) instruction = 'find food and eat'
    else if (time >= 12000 && time <= 23000) instruction = 'prepare for night and seek shelter'
    else {
      const inventoryCount = this.bot.inventory?.items?.().reduce((total, item) => total + item.count, 0) ?? 0
      // A fresh bot should establish the essentials before doing idle
      // exploration: wood, tools, stone, food, and a safe base.
      instruction = inventoryCount === 0
        ? 'run the survival bootstrap and establish a safe base'
        : 'collect useful nearby resources for survival'
    }
    try {
      this.lastActionAt = this.now()
      if (this.cognitiveLoop) await this.cognitiveLoop.run(instruction, -10)
      else await this.taskExecutor.submitCommand(instruction, -10, 'Autonomy')
      log.info({ instruction }, 'Submitted idle autonomous objective')
    } catch (error) {
      log.warn({ err: error.message }, 'Idle autonomous objective was not submitted')
    }
  }
}
