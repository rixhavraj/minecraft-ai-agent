import { logger } from '../utils/logger.js'
import { NPCStateMachine } from '../npc/npcStateMachine.js'
import { RoutineScheduler } from '../npc/routineScheduler.js'
import { HomeManager } from '../npc/homeManager.js'

const log = logger.child({ component: 'NPCBehaviourController' })

const PROFESSIONS = new Set(['farmer', 'miner', 'builder', 'explorer', 'lumberjack', 'fisherman', 'blacksmith', 'trader', 'guard', 'researcher'])

/**
 * The single autonomous NPC brain. It selects activities but never performs
 * Mineflayer actions directly; the shared TaskExecutor remains authoritative.
 */
export class NPCBehaviourController {
  constructor(bot, taskExecutor, { intervalMs = 5_000, profession = 'explorer', home = null, now = Date.now } = {}) {
    this.bot = bot
    this.taskExecutor = taskExecutor
    this.intervalMs = intervalMs
    this.now = now
    this.profession = PROFESSIONS.has(profession) ? profession : 'explorer'
    this.home = home
    this.stateMachine = new NPCStateMachine('INITIALIZING')
    this.scheduler = new RoutineScheduler()
    this.homeManager = new HomeManager({ username: bot.username })
    if (home) this.homeManager.setHome(home)
    this.activity = 'idle'
    this.state = 'awake'
    this.lastDecisionAt = 0
    this.timer = null
    this.cognitiveLoop = null
  }

  setCognitiveLoop(loop) { this.cognitiveLoop = loop }

  setProfession(profession) {
    const normalized = String(profession).toLowerCase()
    if (!PROFESSIONS.has(normalized)) throw new Error(`Unsupported profession: ${profession}`)
    this.profession = normalized
    return this.profession
  }

  setHome(position) {
    if (!position || !['x', 'y', 'z'].every((key) => Number.isFinite(Number(position[key])))) throw new Error('Home requires numeric x, y, z coordinates')
    this.home = { x: Number(position.x), y: Number(position.y), z: Number(position.z) }
    return this.home
  }

  getStatus() {
    return { profession: this.profession, activity: this.activity, state: this.state, npcState: this.stateMachine.snapshot(), phase: this.scheduler.phase(this.bot.time?.timeOfDay), home: this.home, lastDecisionAt: this.lastDecisionAt }
  }

  start() {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => { void this.tick() }, this.intervalMs)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  chooseActivity() {
    const health = this.bot.health ?? 20
    const hunger = this.bot.food ?? 20
    const time = this.bot.time?.timeOfDay ?? 0
    const inventoryCount = this.bot.inventory?.items?.().reduce((total, item) => total + item.count, 0) ?? 0
    if (health <= 8) return { state: 'survival', activity: 'emergency survival', instruction: 'escape danger' }
    if (hunger <= 10) return { state: 'survival', activity: 'food management', instruction: 'find food and eat' }
    if (inventoryCount === 0) return { state: 'working', activity: 'survival bootstrap', instruction: 'run the survival bootstrap and establish a safe base' }
    if (time >= 12000 && time <= 23000) return { state: 'night', activity: 'finding bed and setting spawn', instruction: 'find a bed and sleep to set spawn point' }
    const activities = {
      farmer: 'inspect the farm and harvest mature crops', miner: 'collect useful nearby resources for survival', builder: 'inspect the home and plan maintenance', explorer: 'collect useful nearby resources for survival',
      lumberjack: 'collect 4 oak logs', fisherman: 'find food and eat', blacksmith: 'inspect inventory and equipment', trader: 'locate villagers and useful trades', guard: 'protect the base', researcher: 'collect useful nearby resources for survival',
    }
    return { state: 'working', activity: `${this.profession} routine`, instruction: activities[this.profession] }
  }

  async tick() {
    if (!this.bot.entity || this.taskExecutor.activeTask || this.taskExecutor.queue?.length || this.taskExecutor.isPaused || this.taskExecutor.isEmergencyStopped) return
    if (this.now() - this.lastDecisionAt < this.intervalMs) return
    const decision = this.chooseActivity()
    this.state = decision.state; this.activity = decision.activity; this.lastDecisionAt = this.now()
    const state = decision.state === 'survival' ? 'SURVIVAL_EMERGENCY' : decision.state === 'night' ? 'RETURNING_HOME' : decision.state === 'working' ? 'WORKING' : 'IDLE'
    this.stateMachine.transition(state, decision.instruction)
    try {
      if (this.cognitiveLoop) await this.cognitiveLoop.run(decision.instruction, -10)
      else await this.taskExecutor.submitCommand(decision.instruction, -10, 'NPCBehaviour')
      log.info({ profession: this.profession, activity: this.activity, instruction: decision.instruction }, 'NPC routine selected')
    } catch (error) {
      log.warn({ err: error.message, activity: this.activity }, 'NPC routine could not be submitted')
    }
  }
}

