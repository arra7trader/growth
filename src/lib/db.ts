import { createClient } from '@libsql/client';

const tursoClient = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:local.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export default tursoClient;

export async function initializeDatabase() {
  try {
    // Create logs table
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        context TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create growth_metrics table
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS growth_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        metric_type TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create dynamic_content table
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS dynamic_content (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_type TEXT NOT NULL,
        content_key TEXT UNIQUE NOT NULL,
        content_data TEXT NOT NULL,
        version INTEGER DEFAULT 1,
        is_active BOOLEAN DEFAULT 1,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create affiliate_links table
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS affiliate_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT NOT NULL,
        affiliate_url TEXT NOT NULL,
        conversion_rate REAL DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        revenue REAL DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create evolution_history table
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS evolution_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle_number INTEGER NOT NULL,
        decision_type TEXT NOT NULL,
        decision_data TEXT NOT NULL,
        implementation_status TEXT DEFAULT 'pending',
        github_commit_hash TEXT,
        success_metric REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

export { tursoClient };
