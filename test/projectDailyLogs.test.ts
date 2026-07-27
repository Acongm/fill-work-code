import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProjectHistoryCommit } from '../src/database/commands/projectRepository';
import { ProjectRepository } from '../src/database/commands/projectRepository';
import { CollectionRepository } from '../src/database/commands/collectionRepository';
import { migrateSchema } from '../src/database/commands/migrateSchema';
import { openSqlJsDatabase } from '../src/database/utils/sqlJsDatabase';
import { WorkLogManager } from '../src/daily/utils/workLogManager';
import { loadDailyLog } from '../src/daily/commands/loadDailyLog';
import { buildProjectDailyEntries } from '../src/projects/utils/buildProjectDailyEntries';
import { generateProjectDailyLogs } from '../src/projects/commands/generateProjectDailyLogs';
import { remainingSelectedDates } from '../src/shared/utils/projectDateSelection';

function commit(id: string, subject: string): ProjectHistoryCommit {
  return {
    id,
    cloneId: 'clone-a',
    sha: `${id}123456`,
    subject,
    author: null,
    committedAt: '2026-07-27T10:00:00.000Z',
  };
}

async function createProjectFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'daily-work-log-project-generation-'),
  );
  const database = await openSqlJsDatabase(
    path.join(directory, 'work-log.sqlite'),
  );
  await migrateSchema(database);
  const projects = new ProjectRepository(database);
  await projects.upsertProject({
    id: 'project-a',
    originUrl: 'https://example.com/a.git',
    name: 'A',
  });
  await projects.upsertClone({
    id: 'clone-a',
    projectId: 'project-a',
    repoRoot: '/tmp/project-a',
    cloneLabel: 'project-a',
  });
  await new CollectionRepository(database).saveFacts(
    [
      {
        id: 'commit-26',
        projectId: 'project-a',
        cloneId: 'clone-a',
        sha: 'abc26000',
        subject: 'raw first day',
        committedAt: '2026-07-26T10:00:00.000Z',
      },
      {
        id: 'commit-27',
        projectId: 'project-a',
        cloneId: 'clone-a',
        sha: 'abc27000',
        subject: 'raw second day',
        committedAt: '2026-07-27T10:00:00.000Z',
      },
    ],
    [
      {
        id: 'gitlog-26',
        date: '2026-07-26',
        projectId: 'project-a',
        cloneId: 'clone-a',
        content: '完成第一天功能',
        commitIds: ['commit-26'],
      },
      {
        id: 'gitlog-27',
        date: '2026-07-27',
        projectId: 'project-a',
        cloneId: 'clone-a',
        content: '完成第二天功能',
        commitIds: ['commit-27'],
      },
    ],
  );
  return {
    database,
    directory,
    manager: new WorkLogManager(path.join(directory, 'daily')),
  };
}

suite('Project daily logs', () => {
  test('uses deduplicated structured GitLog before commit subjects', () => {
    assert.deepStrictEqual(
      buildProjectDailyEntries({
        gitlog: [
          { id: 'g1', cloneId: 'clone-a', content: '完成仓库详情调整' },
          { id: 'g2', cloneId: 'clone-a', content: ' 完成仓库详情调整 ' },
        ],
        commits: [commit('a', 'raw commit')],
      }),
      ['完成仓库详情调整'],
    );
  });

  test('falls back to deduplicated commit subjects without GitLog', () => {
    assert.deepStrictEqual(
      buildProjectDailyEntries({
        gitlog: [],
        commits: [
          commit('a', '修复日报闪烁'),
          commit('b', ' 修复日报闪烁 '),
        ],
      }),
      ['修复日报闪烁'],
    );
  });

  test('keeps failed selected dates and removes successful dates', () => {
    assert.deepStrictEqual(
      remainingSelectedDates(
        ['2026-07-25', '2026-07-26', '2026-07-27'],
        ['2026-07-25', '2026-07-27'],
      ),
      ['2026-07-26'],
    );
  });

  test('writes each selected project date to its daily JSON', async () => {
    const fixture = await createProjectFixture();
    try {
      const result = await generateProjectDailyLogs(
        fixture.database,
        fixture.manager,
        'https://example.com/a.git',
        ['2026-07-26', '2026-07-27'],
      );

      assert.deepStrictEqual(result, {
        generatedDates: ['2026-07-26', '2026-07-27'],
        failures: [],
      });
      assert.deepStrictEqual(
        loadDailyLog(fixture.manager, '2026-07-26').completed,
        ['完成第一天功能'],
      );
      assert.deepStrictEqual(
        loadDailyLog(fixture.manager, '2026-07-26').projectLinks,
        [
          {
            field: 'completed',
            content: '完成第一天功能',
            assignment: 'project',
            projectOriginUrl: 'https://example.com/a.git',
          },
        ],
      );
      assert.deepStrictEqual(
        loadDailyLog(fixture.manager, '2026-07-27').completed,
        ['完成第二天功能'],
      );
    } finally {
      await fixture.database.close();
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  test('does not duplicate generated content or project links', async () => {
    const fixture = await createProjectFixture();
    try {
      await generateProjectDailyLogs(
        fixture.database,
        fixture.manager,
        'https://example.com/a.git',
        ['2026-07-26'],
      );
      await generateProjectDailyLogs(
        fixture.database,
        fixture.manager,
        'https://example.com/a.git',
        ['2026-07-26'],
      );

      const log = loadDailyLog(fixture.manager, '2026-07-26');
      assert.deepStrictEqual(log.completed, ['完成第一天功能']);
      assert.strictEqual(log.projectLinks?.length, 1);
    } finally {
      await fixture.database.close();
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  test('writes valid dates while reporting invalid or empty dates', async () => {
    const fixture = await createProjectFixture();
    try {
      const result = await generateProjectDailyLogs(
        fixture.database,
        fixture.manager,
        'https://example.com/a.git',
        ['bad-date', '2026-07-28', '2026-07-27'],
      );

      assert.deepStrictEqual(result.generatedDates, ['2026-07-27']);
      assert.deepStrictEqual(result.failures, [
        { date: 'bad-date', message: '日期格式无效' },
        { date: '2026-07-28', message: '该日期没有可用 Commit' },
      ]);
      assert.deepStrictEqual(
        loadDailyLog(fixture.manager, '2026-07-27').completed,
        ['完成第二天功能'],
      );
    } finally {
      await fixture.database.close();
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
});
