import * as fs from 'fs';
import * as path from 'path';
import initSqlJs from 'sql.js';
import type {
  Database as WorkLogDatabase,
  SqlValue,
} from '../types/database';

interface SqlJsDatabaseOptions {
  wasmPath?: string;
}

function locateSqlJsWasm(explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }

  const bundledPath = path.join(__dirname, 'sql-wasm.wasm');
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  const developmentCandidates = [
    path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'node_modules',
      'sql.js',
      'dist',
      'sql-wasm.wasm',
    ),
    path.join(
      process.cwd(),
      'node_modules',
      'sql.js',
      'dist',
      'sql-wasm.wasm',
    ),
  ];
  const developmentPath = developmentCandidates.find((candidate) =>
    fs.existsSync(candidate),
  );
  if (!developmentPath) {
    throw new Error('Unable to locate sql-wasm.wasm');
  }
  return developmentPath;
}

class PersistentSqlJsDatabase implements WorkLogDatabase {
  private transactionDepth = 0;
  private closed = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly sqlite: initSqlJs.Database,
    private readonly databasePath: string,
  ) {}

  execute(sql: string, params: SqlValue[] = []): void {
    this.assertOpen();
    this.sqlite.run(sql, params);
    if (this.transactionDepth === 0) {
      this.scheduleFlush();
    }
  }

  all<T>(sql: string, params: SqlValue[] = []): T[] {
    this.assertOpen();
    const statement = this.sqlite.prepare(sql);
    try {
      if (params.length > 0) {
        statement.bind(params);
      }
      const rows: T[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  get<T>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  transaction<T>(fn: () => T): T {
    this.assertOpen();
    if (this.transactionDepth > 0) {
      this.transactionDepth += 1;
      try {
        return fn();
      } finally {
        this.transactionDepth -= 1;
      }
    }

    this.sqlite.run('BEGIN IMMEDIATE');
    this.transactionDepth = 1;
    try {
      const result = fn();
      this.sqlite.run('COMMIT');
      this.scheduleFlush();
      return result;
    } catch (error) {
      this.sqlite.run('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
  }

  async flush(): Promise<void> {
    this.assertOpen();
    await this.lastWrite;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.lastWrite;
    this.sqlite.close();
    this.closed = true;
  }

  private scheduleFlush(): void {
    const snapshot = Buffer.from(this.sqlite.export());
    const write = this.writeQueue.then(async () => {
      await fs.promises.mkdir(path.dirname(this.databasePath), {
        recursive: true,
      });
      const temporaryPath = `${this.databasePath}.tmp`;
      await fs.promises.writeFile(temporaryPath, snapshot);
      await fs.promises.rename(temporaryPath, this.databasePath);
    });
    this.lastWrite = write;
    this.writeQueue = write.catch(() => undefined);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Database is closed');
    }
  }
}

export async function openSqlJsDatabase(
  databasePath: string,
  options: SqlJsDatabaseOptions = {},
): Promise<WorkLogDatabase> {
  const wasmPath = locateSqlJsWasm(options.wasmPath);
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });
  const existing = fs.existsSync(databasePath)
    ? await fs.promises.readFile(databasePath)
    : undefined;
  const sqlite = new SQL.Database(existing);
  sqlite.run('PRAGMA foreign_keys = ON');
  return new PersistentSqlJsDatabase(sqlite, databasePath);
}
