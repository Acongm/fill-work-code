import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkLogManager } from '../src/daily/utils/workLogManager';
import { loadTimesheetSource } from '../src/summary/commands/loadTimesheetSource';

suite('Summary JSON source', () => {
  test('timesheet preparation reads JSON without merging Markdown back', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-json-source-'));
    const monthDir = path.join(root, '2026-07');
    const gitlogDir = path.join(monthDir, 'gitlog');
    fs.mkdirSync(gitlogDir, { recursive: true });
    const dailyPath = path.join(monthDir, '2026-07-27.json');
    fs.writeFileSync(
      dailyPath,
      JSON.stringify({
        date: '2026-07-27',
        completed: [],
        plan: [],
        blockers: [],
        notes: '',
        gitlog: ['json value'],
        ailog: [],
        gitCommit: [],
        origin_url: [],
      }),
    );
    fs.writeFileSync(
      path.join(gitlogDir, '工作日报清单.md'),
      '2026/07/27\n- markdown value\n',
    );
    const before = fs.readFileSync(dailyPath, 'utf-8');

    try {
      const source = loadTimesheetSource(new WorkLogManager(root), 2026, 7);
      assert.deepStrictEqual(source.logs[0].gitlog, ['json value']);
      assert.strictEqual(fs.readFileSync(dailyPath, 'utf-8'), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
