#!/bin/bash

# KrushFlow Setup Script - Creates all 6 files

echo "Creating KrushFlow files..."

# Create migrations folder
mkdir -p migrations

# FILE 1: migrations/001_add_session_tables.sql
cat > migrations/001_add_session_tables.sql << 'EOF'
CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(36) PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO users (user_id) VALUES ('default_user');

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

CREATE TABLE IF NOT EXISTS hot_list_entries (
  entry_id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  item_id VARCHAR(36) NOT NULL,
  counted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES count_sessions_v2(session_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES inventory_items(item_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hotlist_session_time ON hot_list_entries(session_id, counted_at DESC);

CREATE TABLE IF NOT EXISTS session_cleanup_log (
  cleanup_id VARCHAR(36) PRIMARY KEY,
  run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sessions_cleaned INTEGER DEFAULT 0
);
EOF

# FILE 2: database.js
cat > database.js << 'EOF'
const { Pool } = require('pg');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const usePostgres = !!process.env.DATABASE_URL;

let db;
let queryFunction;

if (usePostgres) {
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  
  queryFunction = async (sql, params = []) => {
    let pgSql = sql;
    let paramIndex = 1;
    pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    if (pgSql.includes('INSERT IGNORE') || pgSql.includes('INSERT OR IGNORE')) {
      pgSql = pgSql.replace(/INSERT (?:IGNORE|OR IGNORE)/gi, 'INSERT');
      if (!pgSql.includes('ON CONFLICT')) {
        pgSql += ' ON CONFLICT DO NOTHING';
      }
    }
    pgSql = pgSql.replace(/datetime\('now',\s*'([^']+)'\)/gi, (match, interval) => {
      return `NOW() - INTERVAL '${interval.replace('-', '')}'`;
    });
    try {
      const result = await db.query(pgSql, params);
      return result.rows;
    } catch (err) {
      if (err.code === '23505') {
        console.warn('Duplicate key ignored:', err.message);
        return [];
      }
      throw err;
    }
  };
  console.log('✓ Database: PostgreSQL (production mode)');
} else {
  const dbPath = process.env.SQLITE_PATH || './krushflow.db';
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  queryFunction = (sql, params = []) => {
    try {
      sql = sql.replace(/INSERT IGNORE/gi, 'INSERT OR IGNORE');
      const stmt = db.prepare(sql);
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        return stmt.all(...params);
      } else if (sql.trim().toUpperCase().startsWith('INSERT')) {
        const info = stmt.run(...params);
        return [{ insertId: info.lastInsertRowid }];
      } else if (sql.trim().toUpperCase().startsWith('UPDATE')) {
        const info = stmt.run(...params);
        return [{ changes: info.changes }];
      } else if (sql.trim().toUpperCase().startsWith('DELETE')) {
        const info = stmt.run(...params);
        return [{ changes: info.changes }];
      } else {
        stmt.run(...params);
        return [];
      }
    } catch (err) {
      console.error('SQLite query error:', err.message);
      throw err;
    }
  };
  console.log('✓ Database: SQLite (development mode)');
}

async function query(sql, params = []) {
  return queryFunction(sql, params);
}

async function initialize() {
  const migrationPath = path.join(__dirname, 'migrations', '001_add_session_tables.sql');
  if (fs.existsSync(migrationPath)) {
    console.log('Running database migrations...');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    const statements = migrationSql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
    for (const statement of statements) {
      try {
        await query(statement);
      } catch (err) {
        if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
          console.error('Migration error:', err.message);
        }
      }
    }
    console.log('✓ Database migrations complete');
  }
}

async function cleanupAbandonedSessions() {
  try {
    await query(`UPDATE count_sessions_v2 SET status = 'abandoned' WHERE status = 'active' AND last_activity < datetime('now', '-4 hours')`);
    const deleteResult = await query(`DELETE FROM count_sessions_v2 WHERE status = 'abandoned' AND started_at < datetime('now', '-7 days')`);
    const deleted = deleteResult[0]?.changes || 0;
    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} abandoned sessions`);
      await query(`INSERT INTO session_cleanup_log (cleanup_id, sessions_cleaned) VALUES (?, ?)`, [uuidv4(), deleted]);
    }
  } catch (err) {
    console.error('Session cleanup error:', err);
  }
}

async function close() {
  if (usePostgres) {
    await db.end();
  } else {
    db.close();
  }
  console.log('Database connection closed');
}

module.exports = { query, initialize, cleanupAbandonedSessions, close };
EOF

# FILE 3: .env.example
cat > .env.example << 'EOF'
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
GOOGLE_CREDS={"type":"service_account","project_id":"..."}
OPENAI_API_KEY=sk-your-openai-key-here
DATABASE_URL=postgresql://user:pass@host:5432/dbname
ENABLE_DUAL_LLM=true
ENABLE_HOT_LIST=true
ENABLE_SESSIONS=true
PORT=3000
NODE_ENV=production
SQLITE_PATH=./krushflow.db
EOF

# FILE 4: package.json (backup existing first)
if [ -f package.json ]; then
  cp package.json package.json.backup
  echo "Backed up existing package.json to package.json.backup"
fi

cat > package.json << 'EOF'
{
  "name": "krushflow-inventory",
  "version": "2.0.0",
  "description": "AI-powered restaurant inventory management",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "migrate": "node -e \"require('./database').initialize().then(() => process.exit(0))\""
  },
  "dependencies": {
    "@google-cloud/speech": "^6.0.0",
    "@google-cloud/vision": "^4.0.0",
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "sharp": "^0.33.0",
    "node-cache": "^5.1.2",
    "pg": "^8.11.3",
    "better-sqlite3": "^9.2.2",
    "cors": "^2.8.5",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOF

# FILE 5: Append to .gitignore
cat >> .gitignore << 'EOF'

# Database
*.db
*.db-journal
*.db-shm
*.db-wal

# Environment
.env
.env.local
.env.production
EOF

echo ""
echo "✅ All files created!"
echo ""
echo "⚠️  NOTE: server.js is too large for this script."
echo "You need to replace server.js manually - I'll provide it separately."
echo ""
echo "Next steps:"
echo "1. Replace server.js (see separate message)"
echo "2. Run: npm install"
echo "3. Run: npm run dev"