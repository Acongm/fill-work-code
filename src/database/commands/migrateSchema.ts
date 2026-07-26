import type { Database } from '../types/database';
import {
  SCHEMA_VERSION,
  SCHEMA_VERSION_1,
} from '../utils/schema';

function executeScript(database: Database, script: string): void {
  for (const statement of script.split(/;\s*(?:\r?\n|$)/)) {
    const sql = statement.trim();
    if (sql) {
      database.execute(sql);
    }
  }
}

export async function migrateSchema(database: Database): Promise<void> {
  database.transaction(() => {
    database.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    const current =
      database.get<{ version: number }>(
        'SELECT MAX(version) AS version FROM schema_migrations',
      )?.version ?? 0;

    if (current < 1) {
      executeScript(database, SCHEMA_VERSION_1);
      database.execute(
        `INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)`,
        [1, new Date().toISOString()],
      );
    }
  });
  await database.flush();

  const current =
    database.get<{ version: number }>(
      'SELECT MAX(version) AS version FROM schema_migrations',
    )?.version ?? 0;
  if (current !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported database schema version ${current}; expected ${SCHEMA_VERSION}`,
    );
  }
}
