/**
 * Persistent Memory and Database Store for minecraft-ai-squad
 *
 * Implements SQLite storage (backed by node:sqlite) compliant with schema.sql:
 * - agents (10 squad agents)
 * - tasks (lifecycle tracking)
 * - task_events (event log)
 * - memories & lessons learned
 * - observations
 * - resource_usage
 * - blueprints
 */

import { DatabaseSync } from 'node:sqlite'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { logger } from '../utils/logger.js'

const log = logger.child({ component: 'MemoryStore' })

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '../../data/squad.sqlite')

// Normalize task status to match schema.sql CHECK constraint
export function normalizeTaskStatus(status) {
  const map = {
    received: 'received',
    understanding: 'planning',
    planning: 'planning',
    discussion: 'discussion',
    approval: 'approval',
    resource_check: 'planning',
    executing: 'execution',
    execution: 'execution',
    observing: 'execution',
    verifying: 'verification',
    verification: 'verification',
    learning: 'learning',
    completed: 'completed',
    failed: 'failed',
    paused: 'paused',
    cancelled: 'cancelled',
  }
  return map[status] || 'received'
}

export class MemoryStore {
  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath
    mkdirSync(dirname(this.dbPath), { recursive: true })
    this.db = new DatabaseSync(this.dbPath)
    this.initPragmas()
    this.initSchema()
  }

  initPragmas() {
    try {
      this.db.exec('PRAGMA journal_mode = WAL;')
      this.db.exec('PRAGMA busy_timeout = 5000;')
    } catch {
      // ignore pragma issues if any
    }
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(191) NOT NULL UNIQUE,
        role VARCHAR(191) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'offline',
        prompt_version INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id VARCHAR(64) PRIMARY KEY,
        instruction TEXT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'received'
          CHECK (status IN (
            'received', 'planning', 'discussion', 'approval', 'execution',
            'verification', 'learning', 'completed', 'failed', 'paused', 'cancelled'
          )),
        priority INTEGER NOT NULL DEFAULT 0,
        result TEXT,
        error TEXT,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME(3),
        completed_at DATETIME(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS task_events (
        id VARCHAR(64) PRIMARY KEY,
        task_id VARCHAR(64) NOT NULL,
        event VARCHAR(191) NOT NULL,
        details_json TEXT NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS memories (
        id VARCHAR(64) PRIMARY KEY,
        agent_id VARCHAR(64),
        task_id VARCHAR(64),
        kind VARCHAR(64) NOT NULL,
        content TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS observations (
        id VARCHAR(64) PRIMARY KEY,
        task_id VARCHAR(64),
        source VARCHAR(191) NOT NULL,
        content_json TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS resource_usage (
        id VARCHAR(64) PRIMARY KEY,
        task_id VARCHAR(64),
        item VARCHAR(191) NOT NULL,
        quantity INTEGER NOT NULL,
        action VARCHAR(32) NOT NULL CHECK (action IN ('collected', 'consumed', 'crafted', 'dropped')),
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS blueprints (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(191) NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        blueprint_json TEXT NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS world_knowledge (
        id VARCHAR(64) PRIMARY KEY,
        world_id VARCHAR(191) NOT NULL,
        dimension VARCHAR(64) NOT NULL,
        discovery_type VARCHAR(64) NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        details_json TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1,
        observed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS world_sessions (
        world_id VARCHAR(191) NOT NULL,
        username VARCHAR(191) NOT NULL,
        dimension VARCHAR(64),
        last_snapshot_json TEXT NOT NULL,
        last_seen_at DATETIME(3) NOT NULL,
        PRIMARY KEY (world_id, username)
      );

      CREATE TABLE IF NOT EXISTS resource_reservations (
        id VARCHAR(64) PRIMARY KEY,
        task_id VARCHAR(64) NOT NULL,
        item VARCHAR(191) NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        status VARCHAR(32) NOT NULL DEFAULT 'reserved',
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS goals (
        id VARCHAR(64) PRIMARY KEY,
        parent_id VARCHAR(64),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        progress REAL NOT NULL DEFAULT 0,
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        completion_json TEXT NOT NULL DEFAULT '{}',
        failure_json TEXT NOT NULL DEFAULT '{}',
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS benchmark_runs (
        id VARCHAR(64) PRIMARY KEY,
        label VARCHAR(191) NOT NULL,
        mode VARCHAR(32) NOT NULL,
        provider VARCHAR(64),
        model VARCHAR(191),
        seed VARCHAR(191),
        metrics_json TEXT NOT NULL,
        started_at DATETIME(3) NOT NULL,
        completed_at DATETIME(3)
      );

      CREATE TABLE IF NOT EXISTS actions (
        id VARCHAR(64) PRIMARY KEY,
        task_id VARCHAR(64),
        skill_id VARCHAR(191) NOT NULL,
        status VARCHAR(32) NOT NULL CHECK (status IN ('PROPOSED','VALIDATED','APPROVED','EXECUTING','VERIFIED','FAILED','CANCELLED')),
        args_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS model_calls (
        id VARCHAR(64) PRIMARY KEY,
        provider VARCHAR(64) NOT NULL,
        model VARCHAR(191),
        status VARCHAR(32) NOT NULL,
        latency_ms INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        error TEXT,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS skill_stats (
        skill_id VARCHAR(191) PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 0,
        successes INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0,
        total_duration_ms INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
  }

  createAction({ taskId = null, skillId, args = {} }) {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO actions (id, task_id, skill_id, status, args_json, created_at, updated_at)
      VALUES (?, ?, ?, 'PROPOSED', ?, ?, ?)`).run(id, taskId, skillId, JSON.stringify(args), now, now)
    return id
  }

  updateAction(actionId, status, { result = null, error = null } = {}) {
    const now = new Date().toISOString()
    this.db.prepare(`UPDATE actions SET status = ?, result_json = ?, error = ?, updated_at = ? WHERE id = ?`)
      .run(status, result == null ? null : JSON.stringify(result), error, now, actionId)
    return this.db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId)
  }

  getAction(actionId) {
    return this.db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId)
  }

  getRecentActions(limit = 50) {
    return this.db.prepare('SELECT * FROM actions ORDER BY created_at DESC LIMIT ?').all(limit)
  }

  recordModelCall({ provider, model = null, status, latencyMs, usage = null, error = null }) {
    const id = randomUUID()
    this.db.prepare(`INSERT INTO model_calls
      (id, provider, model, status, latency_ms, input_tokens, output_tokens, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, provider, model, status, Math.max(0, Math.round(latencyMs)),
      usage?.inputTokens ?? usage?.prompt_tokens ?? null,
      usage?.outputTokens ?? usage?.completion_tokens ?? null,
      error,
    )
    return id
  }

  getRecentModelCalls(limit = 50) {
    return this.db.prepare('SELECT * FROM model_calls ORDER BY created_at DESC LIMIT ?').all(limit)
  }

  recordSkillStat(skillId, success, durationMs) {
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO skill_stats (skill_id, attempts, successes, failures, total_duration_ms, updated_at)
      VALUES (?, 1, ?, ?, ?, ?)
      ON CONFLICT(skill_id) DO UPDATE SET
        attempts = attempts + 1,
        successes = successes + excluded.successes,
        failures = failures + excluded.failures,
        total_duration_ms = total_duration_ms + excluded.total_duration_ms,
        updated_at = excluded.updated_at`).run(skillId, success ? 1 : 0, success ? 0 : 1, Math.max(0, Math.round(durationMs)), now)
  }

  getSkillStats() {
    return this.db.prepare('SELECT * FROM skill_stats ORDER BY skill_id').all().map(row => ({
      ...row,
      success_rate: row.attempts ? row.successes / row.attempts : 0,
      average_duration_ms: row.attempts ? row.total_duration_ms / row.attempts : 0,
    }))
  }

  // ── Agent Management ────────────────────────────────────────────────────────
  upsertAgent(name, role, status = 'online', customId = null) {
    const now = new Date().toISOString()
    const id = customId || randomUUID()
    const stmt = this.db.prepare(`
      INSERT INTO agents (id, name, role, status, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        role = excluded.role,
        status = excluded.status,
        updated_at = excluded.updated_at
    `)
    stmt.run(id, name, role, status, now)
  }

  getAgents() {
    const stmt = this.db.prepare('SELECT * FROM agents')
    return stmt.all()
  }

  // ── Task Management ─────────────────────────────────────────────────────────
  createTask(instruction, priority = 0) {
    const id = randomUUID()
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, instruction, status, priority, created_at, updated_at)
      VALUES (?, ?, 'received', ?, ?, ?)
    `)
    stmt.run(id, instruction, priority, now, now)
    return id
  }

  updateTaskStatus(taskId, status, result = null, error = null) {
    const now = new Date().toISOString()
    const schemaStatus = normalizeTaskStatus(status)

    if (schemaStatus === 'execution' || schemaStatus === 'planning') {
      const stmt = this.db.prepare(`
        UPDATE tasks SET status = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?
      `)
      stmt.run(schemaStatus, now, now, taskId)
    } else if (schemaStatus === 'completed' || schemaStatus === 'failed' || schemaStatus === 'cancelled') {
      const stmt = this.db.prepare(`
        UPDATE tasks SET status = ?, completed_at = ?, result = ?, error = ?, updated_at = ? WHERE id = ?
      `)
      stmt.run(schemaStatus, now, result ? JSON.stringify(result) : null, error, now, taskId)
    } else {
      const stmt = this.db.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`)
      stmt.run(schemaStatus, now, taskId)
    }

    this.recordTaskEvent(taskId, `status_change:${status}`, { result, error })
  }

  getTask(taskId) {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?')
    return stmt.get(taskId)
  }

  getTaskEvents(taskId, limit = 50) {
    return this.db.prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC LIMIT ?').all(taskId, limit)
  }

  getRecentTasks(limit = 10) {
    const stmt = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?')
    return stmt.all(limit)
  }

  recordTaskEvent(taskId, event, details = {}) {
    const id = randomUUID()
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO task_events (id, task_id, event, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    stmt.run(id, taskId, event, JSON.stringify(details), now)
  }

  // ── Memory and Learning ─────────────────────────────────────────────────────
  recordLesson(kind, content, agentId = null, taskId = null, verified = 1) {
    const id = randomUUID()
    const now = new Date().toISOString()

    // Resolve agentId to existing agent row if needed
    let resolvedAgentId = null
    if (agentId) {
      try {
        const row = this.db.prepare('SELECT id FROM agents WHERE id = ? OR name = ?').get(agentId, agentId)
        if (row) resolvedAgentId = row.id
      } catch {
        resolvedAgentId = null
      }
    }

    // Resolve taskId if provided
    let resolvedTaskId = null
    if (taskId) {
      try {
        const row = this.db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)
        if (row) resolvedTaskId = row.id
      } catch {
        resolvedTaskId = null
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO memories (id, agent_id, task_id, kind, content, verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(id, resolvedAgentId, resolvedTaskId, kind, content, verified ? 1 : 0, now)
    log.info({ kind, content }, 'Lesson recorded into memory')
  }

  getLessons(kind = null, limit = 10) {
    if (kind) {
      const stmt = this.db.prepare('SELECT * FROM memories WHERE kind = ? ORDER BY created_at DESC LIMIT ?')
      return stmt.all(kind, limit)
    }
    const stmt = this.db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?')
    return stmt.all(limit)
  }

  findRelevantLessons(queryText) {
    const words = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    const all = this.getLessons(null, 50)
    return all.filter(m => {
      const c = m.content.toLowerCase()
      return words.some(w => c.includes(w))
    }).slice(0, 5)
  }

  recordExperience({ kind, content, taskId = null, agentId = null, verified = false, importance = 1, source = 'system' }) {
    const allowed = new Set(['episodic', 'semantic', 'procedural', 'strategic', 'failure', 'team'])
    if (!allowed.has(kind)) throw new Error(`Unsupported memory kind: ${kind}`)
    const payload = JSON.stringify({ content, importance, source })
    this.recordLesson(kind, payload, agentId, taskId, verified)
    return this.db.prepare('SELECT * FROM memories WHERE kind = ? ORDER BY created_at DESC LIMIT 1').get(kind)
  }

  retrieveExperiences({ query = '', kinds = null, verifiedOnly = false, limit = 10 } = {}) {
    const clauses = []
    const values = []
    if (kinds?.length) {
      clauses.push(`kind IN (${kinds.map(() => '?').join(',')})`)
      values.push(...kinds)
    }
    if (verifiedOnly) clauses.push('verified = 1')
    if (query) {
      clauses.push('LOWER(content) LIKE ?')
      values.push(`%${query.toLowerCase()}%`)
    }
    values.push(limit)
    return this.db.prepare(`SELECT * FROM memories ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`).all(...values)
  }

  // ── Resource Tracking ───────────────────────────────────────────────────────
  recordResourceUsage(taskId, item, quantity, action) {
    const id = randomUUID()
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO resource_usage (id, task_id, item, quantity, action, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    stmt.run(id, taskId, item, quantity, action, now)
  }

  // ── Blueprints ──────────────────────────────────────────────────────────────
  saveBlueprint(name, blueprintObj, version = 1) {
    const id = randomUUID()
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO blueprints (id, name, version, blueprint_json, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name, version) DO UPDATE SET
        blueprint_json = excluded.blueprint_json,
        created_at = excluded.created_at
    `)
    stmt.run(id, name, version, JSON.stringify(blueprintObj), now)
  }

  getBlueprint(name) {
    const stmt = this.db.prepare('SELECT * FROM blueprints WHERE name = ? ORDER BY version DESC LIMIT 1')
    const row = stmt.get(name)
    if (row) {
      return JSON.parse(row.blueprint_json)
    }
    return null
  }

  recordWorldObservation({ worldId = 'unknown', dimension = 'overworld', discoveryType, x, y, z, details = {}, confidence = 1 }) {
    if (!discoveryType || ![x, y, z].every(Number.isFinite)) throw new Error('World observation requires type and numeric coordinates')
    const id = randomUUID()
    this.db.prepare(`INSERT INTO world_knowledge
      (id, world_id, dimension, discovery_type, x, y, z, details_json, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, worldId, dimension, discoveryType, x, y, z, JSON.stringify(details), Math.max(0, Math.min(1, confidence)))
    return id
  }

  upsertWorldSession({ worldId, username, dimension = null, snapshot }) {
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO world_sessions (world_id, username, dimension, last_snapshot_json, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(world_id, username) DO UPDATE SET
        dimension = excluded.dimension,
        last_snapshot_json = excluded.last_snapshot_json,
        last_seen_at = excluded.last_seen_at`).run(worldId, username, dimension, JSON.stringify(snapshot), now)
  }

  getWorldSessions() {
    return this.db.prepare('SELECT * FROM world_sessions ORDER BY last_seen_at DESC').all().map(row => ({
      ...row,
      snapshot: JSON.parse(row.last_snapshot_json),
    }))
  }

  getWorldObservations({ worldId = null, dimension = null, discoveryType = null, limit = 100 } = {}) {
    const clauses = []
    const values = []
    if (worldId) { clauses.push('world_id = ?'); values.push(worldId) }
    if (dimension) { clauses.push('dimension = ?'); values.push(dimension) }
    if (discoveryType) { clauses.push('discovery_type = ?'); values.push(discoveryType) }
    values.push(limit)
    const rows = this.db.prepare(`SELECT * FROM world_knowledge ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY observed_at DESC LIMIT ?`).all(...values)
    return rows.map((row) => ({ ...row, details: JSON.parse(row.details_json) }))
  }

  reserveResource(taskId, item, quantity) {
    if (!taskId || !item || !Number.isInteger(quantity) || quantity <= 0) throw new Error('Invalid resource reservation')
    const active = this.db.prepare(`SELECT COALESCE(SUM(quantity), 0) AS quantity FROM resource_reservations WHERE item = ? AND status = 'reserved' AND task_id != ?`).get(item, taskId)
    if (active.quantity > 0) throw new Error(`Resource '${item}' is already reserved by another task`)
    const id = randomUUID()
    this.db.prepare(`INSERT INTO resource_reservations (id, task_id, item, quantity) VALUES (?, ?, ?, ?)`).run(id, taskId, item, quantity)
    return { id, item, quantity, alreadyReserved: 0 }
  }

  releaseResourceReservation(id, status = 'released') {
    this.db.prepare('UPDATE resource_reservations SET status = ? WHERE id = ?').run(status, id)
  }

  getResourceReservations(status = 'reserved') {
    return this.db.prepare('SELECT * FROM resource_reservations WHERE status = ? ORDER BY created_at ASC').all(status)
  }

  createGoal({ title, description = title, parentId = null, priority = 0, dependencies = [], completion = {}, failure = {} }) {
    if (!title) throw new Error('Goal title is required')
    const id = randomUUID()
    this.db.prepare(`INSERT INTO goals (id, parent_id, title, description, priority, dependencies_json, completion_json, failure_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, parentId, title, description, priority, JSON.stringify(dependencies), JSON.stringify(completion), JSON.stringify(failure))
    return id
  }

  updateGoal(id, { status, progress, description } = {}) {
    const fields = ['updated_at = ?']
    const values = [new Date().toISOString()]
    if (status) { fields.push('status = ?'); values.push(status) }
    if (progress != null) { fields.push('progress = ?'); values.push(Math.max(0, Math.min(1, progress))) }
    if (description) { fields.push('description = ?'); values.push(description) }
    values.push(id)
    this.db.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  getGoals(status = null) {
    const rows = status
      ? this.db.prepare('SELECT * FROM goals WHERE status = ? ORDER BY priority DESC, updated_at DESC').all(status)
      : this.db.prepare('SELECT * FROM goals ORDER BY priority DESC, updated_at DESC').all()
    return rows.map((row) => ({ ...row, dependencies: JSON.parse(row.dependencies_json), completion: JSON.parse(row.completion_json), failure: JSON.parse(row.failure_json) }))
  }

  createBenchmarkRun({ label, mode = 'live', provider = null, model = null, seed = null, metrics = {} }) {
    if (!label || !['live', 'simulated'].includes(mode)) throw new Error('Benchmark label and valid mode are required')
    const id = randomUUID()
    this.db.prepare(`INSERT INTO benchmark_runs (id, label, mode, provider, model, seed, metrics_json, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, label, mode, provider, model, seed, JSON.stringify(metrics), new Date().toISOString())
    return id
  }

  completeBenchmarkRun(id, metrics = {}) {
    this.db.prepare('UPDATE benchmark_runs SET metrics_json = ?, completed_at = ? WHERE id = ?').run(JSON.stringify(metrics), new Date().toISOString(), id)
  }

  getBenchmarkRuns(limit = 20) {
    return this.db.prepare('SELECT * FROM benchmark_runs ORDER BY started_at DESC LIMIT ?').all(limit).map((row) => ({ ...row, metrics: JSON.parse(row.metrics_json) }))
  }
}

export const memoryStore = new MemoryStore()
