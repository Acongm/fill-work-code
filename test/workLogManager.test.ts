import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkLogManager } from '../src/daily/utils/workLogManager';

function createFixture(): {
  root: string;
  manager: WorkLogManager;
  filePath: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-log-manager-'));
  const monthDir = path.join(root, '2026-07');
  fs.mkdirSync(monthDir, { recursive: true });
  return {
    root,
    manager: new WorkLogManager(root),
    filePath: path.join(monthDir, '2026-07-27.json'),
  };
}

suite('WorkLogManager', () => {
  test('generated Git patch preserves user, AI, and unknown JSON fields', async () => {
    const { root, manager, filePath } = createFixture();
    try {
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            date: '2026-07-27',
            completed: ['manual'],
            plan: ['next'],
            blockers: [],
            notes: 'note',
            gitlog: ['old'],
            ailog: ['keep-ai'],
            gitCommit: [],
            origin_url: [],
            custom: { keep: true },
          },
          null,
          2,
        ),
      );

      await manager.patchGeneratedFields('2026-07-27', 'git', {
        gitlog: ['new'],
        gitCommit: ['abc change'],
        origin_url: ['https://example.com/a.git'],
      });

      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
        completed: string[];
        ailog: string[];
        gitlog: string[];
        custom: { keep: boolean };
      };
      assert.deepStrictEqual(raw.completed, ['manual']);
      assert.deepStrictEqual(raw.ailog, ['keep-ai']);
      assert.deepStrictEqual(raw.custom, { keep: true });
      assert.deepStrictEqual(raw.gitlog, ['new']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('user save and generated patch share one date write queue', async () => {
    const { root, manager, filePath } = createFixture();
    try {
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          date: '2026-07-27',
          completed: [],
          plan: [],
          blockers: [],
          notes: '',
          gitlog: [],
          ailog: [],
          gitCommit: [],
          origin_url: [],
        }),
      );

      await Promise.all([
        manager.saveUserFields('2026-07-27', {
          date: '2026-07-27',
          completed: ['manual'],
          plan: [],
          blockers: [],
          notes: '',
        }),
        manager.patchGeneratedFields('2026-07-27', 'ai', {
          ailog: ['generated'],
        }),
      ]);

      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
        completed: string[];
        ailog: string[];
      };
      assert.deepStrictEqual(raw.completed, ['manual']);
      assert.deepStrictEqual(raw.ailog, ['generated']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
