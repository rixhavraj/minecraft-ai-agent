import { agentRegistry } from '../agents/agent_registry.js'
import { skillRegistry } from '../skills/registry.js'

const STATES = new Set(['WORKING', 'DEGRADED', 'FAILING', 'NOT_IMPLEMENTED', 'NOT_TESTED', 'BLOCKED'])

export class SystemHealthMonitor {
  constructor({ getBot = () => null, taskExecutor = null, memoryStore = null, intervalMs = 30_000 } = {}) {
    this.getBot = getBot; this.taskExecutor = taskExecutor; this.memoryStore = memoryStore
    this.intervalMs = intervalMs; this.components = new Map(); this.timer = null; this.lastReport = null
  }
  check() {
    const bot = this.getBot(); const now = new Date().toISOString(); const report = { generatedAt: now, overall: 'WORKING', components: {}, agents: agentRegistry.listAgents().map((a) => ({ name: a.name, status: a.status === 'online' ? 'WORKING' : 'DEGRADED', lastActive: a.lastActive })) }
    const add = (name, status, details = {}) => { const s = STATES.has(status) ? status : 'NOT_TESTED'; const old = this.components.get(name); const entry = { name, status: s, checkedAt: now, lastSuccessfulTest: s === 'WORKING' ? now : old?.lastSuccessfulTest ?? null, failureCount: (old?.failureCount ?? 0) + (['FAILING', 'BLOCKED'].includes(s) ? 1 : 0), ...details }; this.components.set(name, entry); report.components[name] = entry; if (['FAILING', 'BLOCKED'].includes(s)) report.overall = 'DEGRADED' }
    add('agents', report.agents.every((a) => a.status === 'WORKING') ? 'WORKING' : 'DEGRADED', { count: report.agents.length })
    add('minecraft_connection', bot?.entity ? 'WORKING' : 'NOT_TESTED', { username: bot?.username ?? null })
    add('world_perception', bot?.entity ? 'WORKING' : 'NOT_TESTED', { entityCount: bot?.entities ? Object.keys(bot.entities).length : null })
    add('navigation', bot?.pathfinder ? 'WORKING' : 'NOT_TESTED')
    add('task_executor', this.taskExecutor ? 'WORKING' : 'FAILING')
    add('database', this.memoryStore?.db ? 'WORKING' : 'NOT_TESTED')
    const deps = skillRegistry.validateDependencies(); add('skill_registry', deps.valid ? 'WORKING' : 'FAILING', { skillCount: skillRegistry.size, missingDependencies: deps.missing })
    add('telegram', 'NOT_TESTED', { limitation: 'Requires configured token, group, and reachable Telegram API' })
    add('model_providers', 'NOT_TESTED', { limitation: 'Requires configured provider and model call' })
    add('live_gameplay_suite', 'NOT_TESTED', { limitation: 'Requires a controlled Minecraft world' })
    this.lastReport = report; return report
  }
  start() { if (!this.timer) { this.check(); this.timer = setInterval(() => this.check(), this.intervalMs); this.timer.unref?.() } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
  getReport() { return this.lastReport ?? this.check() }
}
