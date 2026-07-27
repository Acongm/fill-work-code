import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openSqlJsDatabase } from '../src/database/utils/sqlJsDatabase';
import { migrateSchema } from '../src/database/commands/migrateSchema';
import { applyCollection } from '../src/collection/commands/applyCollection';
import { evidenceTsvToFacts } from '../src/collection/utils/evidenceToFacts';
import { ProjectRepository } from '../src/database/commands/projectRepository';
import { listProjects } from '../src/projects/commands/listProjects';
import { loadRegistry } from '../src/shared/utils/repoRegistry';
import { WorkLogManager } from '../src/daily/utils/workLogManager';
import { GitEvidenceService } from '../src/collection/utils/gitEvidenceService';
import { applyGitPreview } from '../src/collection/commands/applyGitPreview';

suite('Daily and collection', () => {
  test('Git preview projects SQLite facts without changing completed', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-preview-'));
    const database = await openSqlJsDatabase(path.join(root, 'work-log.sqlite'));
    const manager = new WorkLogManager(root);
    try {
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
        repoRoot: '/tmp/a',
        cloneLabel: 'a',
      });
      await applyCollection(database, root, {
        commits: [
          {
            id: 'commit-a',
            projectId: 'project-a',
            cloneId: 'clone-a',
            sha: 'abcdef123456',
            subject: 'structured change',
            committedAt: '2026-07-27T10:00:00.000Z',
          },
        ],
        gitlogEntries: [
          {
            id: 'gitlog-a',
            date: '2026-07-27',
            projectId: 'project-a',
            cloneId: 'clone-a',
            content: 'structured change',
            commitIds: ['commit-a'],
          },
        ],
      });
      manager.saveDailyLog(new Date(2026, 6, 27, 12), {
        date: '2026-07-27',
        completed: ['manual completed'],
        plan: [],
        blockers: [],
        notes: '',
        gitlog: [],
        ailog: [],
        gitCommit: [],
        origin_url: [],
      });

      await applyGitPreview(
        {
          database,
          workLogManager: manager,
          ensureStructuredEvidence: async () => ({
            hydrated: true,
            missingMonths: [],
          }),
        },
        {
          scope: 'day',
          anchorDate: '2026-07-27',
          dates: ['2026-07-27'],
          source: 'git',
          days: [
            {
              date: '2026-07-27',
              completed: ['must not overwrite'],
              gitlog: ['preview value'],
              gitCommit: ['preview value'],
              originUrl: ['preview value'],
              ailogDraft: [],
              warnings: [],
            },
          ],
        },
      );

      const saved = manager.getDailyLog(new Date(2026, 6, 27, 12));
      assert.deepStrictEqual(saved?.completed, ['manual completed']);
      assert.deepStrictEqual(saved?.gitlog, ['structured change']);
      assert.deepStrictEqual(saved?.gitCommit, ['abcdef12 structured change']);
    } finally {
      await database.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('cache evidence hydrates SQLite from commits TSV', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-cache-hydrate-'));
    const monthDir = path.join(root, '2026-07');
    fs.mkdirSync(monthDir, { recursive: true });
    fs.writeFileSync(
      path.join(monthDir, '_commits.tsv'),
      [
        '/tmp/a',
        'a',
        'https://example.com/a.git',
        'deadbeefcafebabe',
        '',
        '2026-07-27',
        '',
        'acongm',
        'cached change',
        '',
        '',
      ].join('\t'),
    );
    const database = await openSqlJsDatabase(path.join(root, 'work-log.sqlite'));
    try {
      await migrateSchema(database);
      const result = await new GitEvidenceService('', root).ensureStructuredEvidence(
        {
          scope: 'day',
          anchorDate: '2026-07-27',
        },
        database,
      );
      assert.deepStrictEqual(result.missingMonths, []);
      assert.strictEqual(result.hydrated, true);
      assert.strictEqual(
        database.get<{ count: number }>('SELECT COUNT(*) AS count FROM commits')
          ?.count,
        1,
      );
    } finally {
      await database.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('collected commits retain project links through confirmation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collection-items-'));
    const database = await openSqlJsDatabase(path.join(root, 'work-log.sqlite'));
    const projects = new ProjectRepository(database);
    try {
      await migrateSchema(database);
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
      await applyCollection(database, root, {
        commits: [
          {
            id: 'commit-a',
            projectId: 'project-a',
            cloneId: 'clone-a',
            sha: 'abc1234',
            subject: 'change',
            committedAt: '2026-07-26T10:00:00.000Z',
          },
        ],
        gitlogEntries: [
          {
            id: 'gitlog-a',
            date: '2026-07-26',
            projectId: 'project-a',
            cloneId: 'clone-a',
            content: 'change',
            commitIds: ['commit-a'],
          },
        ],
      });
      const history = await projects.getHistory('project-a');
      assert.strictEqual(history.days[0].commits[0].sha, 'abc1234');
      assert.strictEqual(history.days[0].gitlog[0].content, 'change');
    } finally {
      await database.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('evidence TSV persists to SQLite first then dual-writes commits and registry', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-dual-write-'));
    const database = await openSqlJsDatabase(path.join(root, 'work-log.sqlite'));
    try {
      await migrateSchema(database);
      const tsv = [
        [
          '/tmp/fill-work-code',
          'fill-work-code',
          'https://github.com/Acongm/fill-work-code.git',
          'deadbeefcafebabe',
          '',
          '2026-07-26',
          '',
          'acongm',
          'feat sqlite dual write',
          '',
          '',
        ].join('\t'),
        '',
      ].join('\n');

      const facts = evidenceTsvToFacts(database, tsv, {
        collectionRunId: 'run:test',
      });
      assert.strictEqual(facts.commits.length, 1);
      assert.strictEqual(facts.projectCount, 1);

      const { warnings } = await applyCollection(database, root, {
        commits: facts.commits,
        gitlogEntries: facts.gitlogEntries,
      });
      assert.deepStrictEqual(warnings, []);

      const projects = listProjects(database);
      assert.strictEqual(projects.length, 1);
      assert.strictEqual(
        projects[0].originUrl,
        'https://github.com/Acongm/fill-work-code.git',
      );

      const history = await new ProjectRepository(database).getHistory(
        projects[0].id,
      );
      assert.strictEqual(history.days[0].commits[0].sha, 'deadbeefcafebabe');

      const commitsPath = path.join(root, '2026-07', '_commits.tsv');
      assert.ok(fs.existsSync(commitsPath));
      const exported = fs.readFileSync(commitsPath, 'utf-8');
      assert.ok(exported.includes('feat sqlite dual write'));
      assert.ok(exported.includes('deadbeefcafebabe'));

      const registry = loadRegistry(root);
      assert.strictEqual(registry.repos.length, 1);
      assert.strictEqual(
        registry.repos[0].originUrl,
        'https://github.com/Acongm/fill-work-code.git',
      );
      assert.strictEqual(registry.repos[0].repoRoot, '/tmp/fill-work-code');
    } finally {
      await database.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
