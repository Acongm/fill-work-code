import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Database } from '../src/database/types/database';
import { openSqlJsDatabase } from '../src/database/utils/sqlJsDatabase';
import { migrateSchema } from '../src/database/commands/migrateSchema';
import { DailyItemRepository } from '../src/database/commands/dailyItemRepository';
import { ProjectRepository } from '../src/database/commands/projectRepository';
import { CollectionRepository } from '../src/database/commands/collectionRepository';
import { AiConversationRepository } from '../src/database/commands/aiConversationRepository';
import { ProjectionRepository } from '../src/database/commands/projectionRepository';

async function createTestDatabase(): Promise<{
  database: Database;
  directory: string;
}> {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'daily-work-log-database-'),
  );
  const database = await openSqlJsDatabase(path.join(directory, 'work-log.sqlite'));
  await migrateSchema(database);
  return { database, directory };
}

suite('Database', () => {
  test('tracks field-scoped JSON projection state', async () => {
    const fixture = await createTestDatabase();
    const repository = new ProjectionRepository(fixture.database);
    try {
      await repository.markPending('2026-07-27', 'git', 3);
      assert.deepStrictEqual(repository.get('2026-07-27', 'git'), {
        date: '2026-07-27',
        group: 'git',
        sourceRevision: 3,
        projectedRevision: 0,
        status: 'pending',
        lastError: null,
      });

      await repository.markFailed('2026-07-27', 'git', 'disk full');
      assert.strictEqual(repository.listPending()[0].status, 'failed');

      await repository.markProjected('2026-07-27', 'git', 3);
      assert.deepStrictEqual(repository.listPending(), []);
      assert.strictEqual(
        repository.get('2026-07-27', 'git')?.projectedRevision,
        3,
      );
    } finally {
      await fixture.database.close();
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  test('enforces explicit project or unassigned daily item assignment', async () => {
    const fixture = await createTestDatabase();
    const repo = new DailyItemRepository(fixture.database);

    try {
      await assert.rejects(() =>
        repo.insert({
          id: 'bad',
          date: '2026-07-26',
          kind: 'todo',
          content: 'invalid',
          assignment: 'project',
          projectId: null,
          source: 'manual',
          sortOrder: 0,
        }),
      );
    } finally {
      await fixture.database.close();
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  test('returns only project-linked generated items from SQLite history', async () => {
    const fixture = await createTestDatabase();
    const projects = new ProjectRepository(fixture.database);
    const dailyItems = new DailyItemRepository(fixture.database);

    try {
      await projects.upsertProject({
        id: 'project-a',
        originUrl: 'https://example.com/a.git',
        name: 'A',
      });
      await projects.upsertProject({
        id: 'project-b',
        originUrl: 'https://example.com/b.git',
        name: 'B',
      });
      await dailyItems.insert({
        id: 'item-a',
        date: '2026-07-26',
        kind: 'completed',
        content: 'project A item',
        assignment: 'project',
        projectId: 'project-a',
        source: 'ai',
        sortOrder: 0,
      });
      await dailyItems.insert({
        id: 'item-b',
        date: '2026-07-26',
        kind: 'completed',
        content: 'project B item',
        assignment: 'project',
        projectId: 'project-b',
        source: 'manual',
        sortOrder: 0,
      });

      const history = await projects.getHistory('project-a');
      assert.deepStrictEqual(
        history.days[0].items.map((item) => item.content),
        ['project A item'],
      );
    } finally {
      await fixture.database.close();
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  test('persists collected facts and complete AI messages', async () => {
    const fixture = await createTestDatabase();
    const databasePath = path.join(fixture.directory, 'work-log.sqlite');
    const projects = new ProjectRepository(fixture.database);
    const collection = new CollectionRepository(fixture.database);
    const conversations = new AiConversationRepository(fixture.database);

    try {
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
      await collection.saveFacts(
        [
          {
            id: 'commit-a',
            projectId: 'project-a',
            cloneId: 'clone-a',
            sha: 'abc123',
            subject: 'Add persistence',
            committedAt: '2026-07-26T10:00:00.000Z',
          },
        ],
        [
          {
            id: 'gitlog-a',
            date: '2026-07-26',
            projectId: 'project-a',
            cloneId: 'clone-a',
            content: 'Add persistence',
            commitIds: ['commit-a'],
          },
        ],
      );
      await conversations.upsertSession({
        id: 'session-a',
        provider: 'codex',
        externalSessionId: 'external-a',
        projectId: 'project-a',
        cloneId: 'clone-a',
        cwd: '/tmp/project-a',
        sourcePath: '/tmp/session.jsonl',
        sourceHash: 'hash-a',
      });
      await conversations.replaceMessages('session-a', [
        {
          id: 'message-a',
          sessionId: 'session-a',
          role: 'user',
          content: '完整问题内容',
          sequence: 0,
        },
        {
          id: 'message-b',
          sessionId: 'session-a',
          role: 'assistant',
          content: '完整回答内容',
          sequence: 1,
        },
      ]);
      await fixture.database.close();

      const reopened = await openSqlJsDatabase(databasePath);
      await migrateSchema(reopened);
      const reopenedProjects = new ProjectRepository(reopened);
      const reopenedConversations = new AiConversationRepository(reopened);
      const history = await reopenedProjects.getHistory('project-a');

      assert.strictEqual(history.days[0].commits[0].sha, 'abc123');
      assert.strictEqual(history.days[0].gitlog[0].content, 'Add persistence');
      assert.deepStrictEqual(
        reopenedConversations
          .listMessages('session-a')
          .map((message) => message.content),
        ['完整问题内容', '完整回答内容'],
      );
      await reopened.close();
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
});
