// database.js - Production-ready database abstraction with connection pooling
const { Pool } = require('pg');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const usePostgres = !!process.env.DATABASE_URL;

let db;
let queryFunction;

if (usePostgres) {
  // PostgreSQL (Railway production)
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  
  // Convert ? placeholders to $1, $2, etc.
  queryFunction = async (sql, params = []) => {
    let pgSql = sql;
    let paramIndex = 1;
    
    // Replace ? with $1, $2, $3...
    pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    
    // Handle INSERT IGNORE (PostgreSQL uses INSERT ... ON CONFLICT DO NOTHING)
    if (pgSql.includes('INSERT IGNORE') || pgSql.includes('INSERT OR IGNORE')) {
      pgSql = pgSql.replace(/INSERT (?:IGNORE|OR IGNORE)/gi, 'INSERT');
      
      if (!pgSql.includes('ON CONFLICT')) {
        pgSql += ' ON CONFLICT DO NOTHING';
      }
    }
    
    // Handle datetime() function (SQLite) -> NOW() (PostgreSQL)
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
  // SQLite (local development)
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
      console.error('SQL:', sql);
      console.error('Params:', params);
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
    
    const statements = migrationSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
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
  } else {
    console.log('No migrations found, skipping...');
  }
}

async function cleanupAbandonedSessions() {
  try {
    const markResult = await query(
      `UPDATE count_sessions_v2 
       SET status = 'abandoned' 
       WHERE status = 'active' 
       AND last_activity < datetime('now', '-4 hours')`
    );
    
    const deleteResult = await query(
      `DELETE FROM count_sessions_v2 
       WHERE status = 'abandoned' 
       AND started_at < datetime('now', '-7 days')`
    );
    
    const deleted = deleteResult[0]?.changes || 0;
    
    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} abandoned sessions`);
      
      const cleanupId = uuidv4();
      await query(
        `INSERT INTO session_cleanup_log (cleanup_id, sessions_cleaned) VALUES (?, ?)`,
        [cleanupId, deleted]
      );
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

module.exports = { 
  query, 
  initialize, 
  cleanupAbandonedSessions,
  close 
};