import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openSqlJsDatabase } from '../src/database/utils/sqlJsDatabase';
import { migrateSchema } from '../src/database/commands/migrateSchema';
import { migrateLegacyData } from '../src/database/commands/legacyMigrator';
import { DailyItemRepository } from '../src/database/commands/dailyItemRepository';

function copyFixture(): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-work-log-legacy-'));
  fs.cpSync(path.join(__dirname, '../../test/fixtures/legacy'), target, {
    recursive: true,
  });
  return target;
}

suite('Legacy migration', () => {
  test('is idempotent and preserves ambiguous items as unassigned', async () => {
    const storageRoot = copyFixture();
    const dailyPath = path.join(
      storageRoot,
      '2026-07',
      '2026-07-25.json',
    );
    const originalDaily = fs.readFileSync(dailyPath, 'utf-8');
    const database = await openSqlJsDatabase(
      path.join(storageRoot, 'work-log.sqlite'),
    );

    try {
      await migrateSchema(database);
      const first = await migrateLegacyData(database, storageRoot);
      const second = await migrateLegacyData(database, storageRoot);
      const items = new DailyItemRepository(database).listByDate('2026-07-25');

      assert.ok(first.imported > 0);
      assert.ok(second.skipped > 0);
      assert.strictEqual(items.length, 2);
      assert.ok(items.every((item) => item.assignment === 'unassigned'));
      assert.strictEqual(fs.readFileSync(dailyPath, 'utf-8'), originalDaily);
    } finally {
      await database.close();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});
