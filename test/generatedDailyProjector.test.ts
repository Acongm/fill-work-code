import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Database } from '../src/database/types/database';
import { migrateSchema } from '../src/database/commands/migrateSchema';
import { openSqlJsDatabase } from '../src/database/utils/sqlJsDatabase';
import { ProjectRepository } from '../src/database/commands/projectRepository';
import { CollectionRepository } from '../src/database/commands/collectionRepository';
import { DailyItemRepository } from '../src/database/commands/dailyItemRepository';
import { ProjectionRepository } from '../src/database/commands/projectionRepository';
import { WorkLogManager } from '../src/daily/utils/workLogManager';
import { GeneratedDailyProjector } from '../src/daily/commands/generatedDailyProjector';

async function createFixture(): Promise<{
  root: string;
  database: Database;
  manager: WorkLogManager;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-projector-'));
  const database = await openSqlJsDatabase(path.join(root, 'work-log.sqlite'));
  await migrateSchema(database);
  return { root, database, manager: new WorkLogManager(root) };
}

suite('GeneratedDailyProjector', () => {
  test('projects Git and AI groups independently', async () => {
    const fixture = await createFixture();
    try {
      const projects = new ProjectRepository(fixture.database);
      await projects.upsertProject({
        id: 'project-a',
        originUrl: 'https://example.com/a.git',
        name: 'A',
      });
      await projects.upsertClone({
        id: 'clone-a',
        projectId: 'project-a',
        repoRoot: '/tmp/a',
        cloneLabel: 'a',
      });
      await new CollectionRepository(fixture.database).saveFacts(
        [
          {
            id: 'commit-a',
            projectId: 'project-a',
            cloneId: 'clone-a',
            sha: 'abcdef123456',
            subject: 'change',
            committedAt: '2026-07-27T10:00:00.000Z',
          },
        ],
        [
          {
            id: 'gitlog-a',
            date: '2026-07-27',
            projectId: 'project-a',
            cloneId: 'clone-a',
            content: 'project: change',
            commitIds: ['commit-a'],
          },
        ],
      );
      await new DailyItemRepository(fixture.database).insert({
        id: 'ai-a',
        date: '2026-07-27',
        kind: 'ailog',
        content: 'new ai',
        assignment: 'unassigned',
        projectId: null,
        source: 'ai',
        sortOrder: 0,
      });
      fixture.manager.saveDailyLog(new Date(2026, 6, 27, 12), {
        date: '2026-07-27',
        completed: ['manual'],
        plan: [],
        blockers: [],
        notes: '',
        gitlog: ['old git'],
        ailog: ['old ai'],
        gitCommit: [],
        origin_url: [],
      });

      const projector = new GeneratedDailyProjector(
        fixture.database,
        fixture.manager,
      );
      await projector.project('2026-07-27', ['git'], 1);
      let log = fixture.manager.getDailyLog(new Date(2026, 6, 27, 12));
      assert.deepStrictEqual(log?.gitlog, ['project: change']);
      assert.deepStrictEqual(log?.gitCommit, ['abcdef12 change']);
      assert.deepStrictEqual(log?.origin_url, ['https://example.com/a.git']);
      assert.deepStrictEqual(log?.ailog, ['old ai']);
      assert.deepStrictEqual(log?.completed, ['manual']);

      await projector.project('2026-07-27', ['ai'], 2);
      log = fixture.manager.getDailyLog(new Date(2026, 6, 27, 12));
      assert.deepStrictEqual(log?.ailog, ['new ai']);
      assert.deepStrictEqual(log?.gitlog, ['project: change']);
    } finally {
      await fixture.database.close();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test('records a failed projection for retry', async () => {
    const fixture = await createFixture();
    try {
      const writer = {
        patchGeneratedFields: async () => {
          throw new Error('disk full');
        },
      };
      const projector = new GeneratedDailyProjector(
        fixture.database,
        writer,
      );

      await assert.rejects(
        () => projector.project('2026-07-27', ['git'], 4),
        /disk full/,
      );

      const state = new ProjectionRepository(fixture.database).get(
        '2026-07-27',
        'git',
      );
      assert.strictEqual(state?.status, 'failed');
      assert.strictEqual(state?.lastError, 'disk full');
    } finally {
      await fixture.database.close();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
