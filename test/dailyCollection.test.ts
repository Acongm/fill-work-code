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

suite('Daily and collection', () => {
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
