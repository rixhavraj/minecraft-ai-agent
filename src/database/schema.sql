CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(191) NOT NULL UNIQUE,
  role VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'offline'
    CHECK (status IN ('offline', 'online', 'busy', 'paused', 'error')),
  prompt_version INTEGER NOT NULL DEFAULT 1 CHECK (prompt_version > 0),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
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
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3),
  completed_at DATETIME(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX tasks_status_created_at (status, created_at)
);

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64),
  sender VARCHAR(191) NOT NULL,
  receiver VARCHAR(191),
  type VARCHAR(64) NOT NULL,
  content_json TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX messages_task_created_at (task_id, created_at),
  CONSTRAINT messages_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id VARCHAR(64) PRIMARY KEY,
  agent_id VARCHAR(64),
  task_id VARCHAR(64),
  kind VARCHAR(64) NOT NULL,
  content TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX memories_kind_verified (kind, verified),
  CONSTRAINT memories_agent_fk FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
  CONSTRAINT memories_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS observations (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64),
  source VARCHAR(191) NOT NULL,
  content_json TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT observations_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS resource_usage (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64),
  item VARCHAR(191) NOT NULL,
  quantity INTEGER NOT NULL,
  action VARCHAR(32) NOT NULL CHECK (action IN ('collected', 'consumed', 'crafted', 'dropped')),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT resource_usage_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS blueprints (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  blueprint_json TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(name, version)
);

CREATE TABLE IF NOT EXISTS task_events (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL,
  event VARCHAR(191) NOT NULL,
  details_json TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX task_events_task_created_at (task_id, created_at),
  CONSTRAINT task_events_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
