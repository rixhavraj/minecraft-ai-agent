import test from 'node:test'
import assert from 'node:assert/strict'
import { SystemHealthMonitor } from '../src/monitoring/system_health_monitor.js'

test('health monitor reports explicit states without inventing live verification', () => {
  const report = new SystemHealthMonitor({ taskExecutor: {}, memoryStore: { db: {} } }).check()
  assert.equal(report.agents.length, 10)
  assert.equal(report.components.task_executor.status, 'WORKING')
  assert.equal(report.components.minecraft_connection.status, 'NOT_TESTED')
  assert.equal(report.components.live_gameplay_suite.status, 'NOT_TESTED')
  assert.equal(report.components.skill_registry.status, 'WORKING')
})
