-- Migration: Add session management tables
-- Safe to run multiple times (IF NOT EXISTS)

-- Users table (if not exists)
CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure default user exists
INSERT OR IGNORE INTO users (user_id) VALUES ('default_user');

-- Count Sessions V2
CREATE TABLE IF NOT EXISTS count_sessions_v2 (
  session_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  list_id VARCHAR(36) NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'finalized', 'abandoned')),
  hot_list TEXT,
  pending_commands TEXT,
  unresolved_count INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (list_id) REFERENCES inventory_lists(list_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON count_sessions_v2(user_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_activity ON count_sessions_v2(last_activity);

-- Session Totals
CREATE TABLE IF NOT EXISTS session_totals (
  total_id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  item_id VARCHAR(36) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES count_sessions_v2(session_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES inventory_items(item_id) ON DELETE CASCADE,
  UNIQUE(session_id, item_id)
);

-- Hot List History
CREATE TABLE IF NOT EXISTS hot_list_entries (
  entry_id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  item_id VARCHAR(36) NOT NULL,
  counted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES count_sessions_v2(session_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES inventory_items(item_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hotlist_session_time ON hot_list_entries(session_id, counted_at DESC);

-- Session cleanup log
CREATE TABLE IF NOT EXISTS session_cleanup_log (
  cleanup_id VARCHAR(36) PRIMARY KEY,
  run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sessions_cleaned INTEGER DEFAULT 0
);