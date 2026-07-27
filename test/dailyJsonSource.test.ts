import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkLogManager } from '../src/daily/utils/workLogManager';
import {
  loadDailyLog,
  loadMonthlyLogs,
} from '../src/daily/commands/loadDailyLog';

suite('Daily JSON source', () => {
  test('loads existing daily and monthly JSON without SQLite facts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-json-source-'));
    const monthDir = path.join(root, '2026-07');
    fs.mkdirSync(monthDir, { recursive: true });
    fs.writeFileSync(
      path.join(monthDir, '2026-07-27.json'),
      JSON.stringify({
        date: '2026-07-27',
        completed: ['visible from JSON'],
        plan: [],
        blockers: [],
        notes: '',
        gitlog: ['json gitlog'],
        ailog: [],
        gitCommit: [],
        origin_url: [],
      }),
    );
    const manager = new WorkLogManager(root);

    try {
      assert.deepStrictEqual(
        loadDailyLog(manager, '2026-07-27').completed,
        ['visible from JSON'],
      );
      assert.deepStrictEqual(
        loadMonthlyLogs(manager, 2026, 7).logs.map((log) => log.date),
        ['2026-07-27'],
      );
      assert.deepStrictEqual(
        manager.getAllDailyLogs().map((log) => log.date),
        ['2026-07-27'],
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
