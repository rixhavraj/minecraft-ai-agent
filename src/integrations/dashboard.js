import { createServer } from 'node:http'
import { skillRegistry } from '../skills/registry.js'
import { agentRegistry } from '../agents/agent_registry.js'
import { memoryStore } from '../database/memory_store.js'

export function createDashboard({ port = 0, bot, getBot = null, taskExecutor, healthMonitor = null }) {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Access-Control-Allow-Origin', 'http://localhost')
    const currentBot = getBot?.() ?? bot
    const position = currentBot?.entity?.position
    const payload = request.url === '/health'
      ? (healthMonitor?.getReport() ?? { ok: true, minecraftConnected: Boolean(currentBot?.entity), timestamp: new Date().toISOString() })
      : request.url === '/health/components'
        ? (healthMonitor?.getReport()?.components ?? {})
      : request.url === '/agents'
        ? { agents: agentRegistry.listAgents() }
        : request.url === '/skills'
          ? { skills: skillRegistry.list() }
          : request.url === '/memory'
            ? { memories: memoryStore.retrieveExperiences({ limit: 20 }) }
            : request.url === '/actions'
              ? { actions: memoryStore.getRecentActions(50) }
              : request.url === '/goals'
                ? { goals: memoryStore.getGoals() }
                : request.url === '/benchmarks'
                  ? { benchmarks: memoryStore.getBenchmarkRuns(50) }
                  : request.url === '/providers'
                    ? { calls: memoryStore.getRecentModelCalls(100) }
                  : request.url === '/skill-stats'
                    ? { stats: memoryStore.getSkillStats() }
                  : request.url === '/world-sessions'
                    ? { sessions: memoryStore.getWorldSessions() }
                  : { bot: { connected: Boolean(currentBot?.entity), username: currentBot?.username ?? null, health: currentBot?.health ?? null, hunger: currentBot?.food ?? null, position: position ? { x: position.x, y: position.y, z: position.z } : null }, task: taskExecutor?.getStatus?.() ?? null, agents: agentRegistry.listAgents().map(({ id, name, status, role }) => ({ id, name, status, role })) }
    response.end(JSON.stringify(payload))
  })
  server.listen(port, '127.0.0.1')
  return server
}
