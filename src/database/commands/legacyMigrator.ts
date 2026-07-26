import * as crypto from 'crypto';
import * as path from 'path';
import type { Database } from '../types/database';
import {
  discoverLegacySources,
  fingerprintLegacyFile,
  readLegacyCommits,
  readLegacyDaily,
  readLegacyRegistry,
  type LegacyFingerprint,
  type LegacySource,
} from '../utils/legacyReaders';

export interface LegacyMigrationReport {
  imported: number;
  skipped: number;
  errors: Array<{ path: string; message: string }>;
}

interface ProjectIdentity {
  projectId: string;
  cloneId: string;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}:${crypto
    .createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 24)}`;
}

function hasImportedFingerprint(
  database: Database,
  fingerprint: LegacyFingerprint,
): boolean {
  const row = database.get<{
    source_size: number;
    source_mtime_ms: number;
    source_hash: string;
  }>(
    `SELECT source_size, source_mtime_ms, source_hash
     FROM legacy_imports WHERE source_path = ?`,
    [fingerprint.sourcePath],
  );
  return Boolean(
    row &&
      row.source_size === fingerprint.sourceSize &&
      row.source_mtime_ms === fingerprint.sourceMtimeMs &&
      row.source_hash === fingerprint.sourceHash,
  );
}

function recordFingerprint(
  database: Database,
  fingerprint: LegacyFingerprint,
): void {
  database.execute(
    `INSERT INTO legacy_imports(
      source_path, source_size, source_mtime_ms, source_hash, imported_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_path) DO UPDATE SET
      source_size = excluded.source_size,
      source_mtime_ms = excluded.source_mtime_ms,
      source_hash = excluded.source_hash,
      imported_at = excluded.imported_at`,
    [
      fingerprint.sourcePath,
      fingerprint.sourceSize,
      fingerprint.sourceMtimeMs,
      fingerprint.sourceHash,
      new Date().toISOString(),
    ],
  );
}

function ensureProjectAndClone(
  database: Database,
  input: {
    repoRoot: string;
    repoName: string;
    originUrl: string;
    cloneId?: string;
    cloneLabel?: string;
    firstSeenAt?: string;
    lastScannedAt?: string | null;
    lastCommitAt?: string | null;
    pinned?: boolean;
    hidden?: boolean;
  },
): ProjectIdentity {
  const originUrl = input.originUrl || `local:${path.resolve(input.repoRoot)}`;
  const now = new Date().toISOString();
  const preferredProjectId = stableId('project', originUrl);
  database.execute(
    `INSERT INTO projects(
      id, origin_url, name, pinned, hidden, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(origin_url) DO UPDATE SET
      name = excluded.name,
      pinned = MAX(projects.pinned, excluded.pinned),
      hidden = MAX(projects.hidden, excluded.hidden),
      updated_at = excluded.updated_at`,
    [
      preferredProjectId,
      originUrl,
      input.repoName || path.basename(input.repoRoot) || originUrl,
      input.pinned ? 1 : 0,
      input.hidden ? 1 : 0,
      input.firstSeenAt || now,
      now,
    ],
  );
  const projectId =
    database.get<{ id: string }>(
      'SELECT id FROM projects WHERE origin_url = ?',
      [originUrl],
    )?.id || preferredProjectId;

  const existingClone = database.get<{ id: string }>(
    'SELECT id FROM project_clones WHERE repo_root = ?',
    [input.repoRoot],
  );
  const cloneId =
    existingClone?.id ||
    input.cloneId ||
    stableId('clone', path.resolve(input.repoRoot));
  database.execute(
    `INSERT INTO project_clones(
      id, project_id, repo_root, clone_label, first_seen_at,
      last_scanned_at, last_commit_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_root) DO UPDATE SET
      project_id = excluded.project_id,
      clone_label = excluded.clone_label,
      last_scanned_at = excluded.last_scanned_at,
      last_commit_at = excluded.last_commit_at`,
    [
      cloneId,
      projectId,
      input.repoRoot,
      input.cloneLabel || path.basename(input.repoRoot) || input.repoName,
      input.firstSeenAt || now,
      input.lastScannedAt ?? null,
      input.lastCommitAt ?? null,
    ],
  );
  return { projectId, cloneId };
}

function importRegistry(database: Database, source: LegacySource): void {
  const registry = readLegacyRegistry(source.path);
  for (const repo of registry.repos) {
    ensureProjectAndClone(database, {
      repoRoot: repo.repoRoot,
      repoName: repo.repoName,
      originUrl: repo.originUrl,
      cloneId: repo.id,
      cloneLabel: repo.cloneLabel,
      firstSeenAt: repo.firstSeenAt,
      lastScannedAt: repo.lastScannedAt,
      lastCommitAt: repo.lastCommitAt ?? null,
      pinned: repo.pinned,
      hidden: repo.hidden,
    });
  }
}

function importCommits(database: Database, source: LegacySource): void {
  for (const row of readLegacyCommits(source.path)) {
    const identity = ensureProjectAndClone(database, {
      repoRoot: row.repoRoot,
      repoName: row.repoName,
      originUrl: row.originUrl,
      lastCommitAt: row.commitDay,
    });
    const commitKey =
      row.sha || `${row.repoRoot}:${row.commitDay}:${row.subject}`;
    const commitId = stableId('commit', `${identity.cloneId}:${commitKey}`);
    database.execute(
      `INSERT INTO commits(
        id, project_id, clone_id, sha, subject, author,
        committed_at, collection_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(clone_id, sha) DO UPDATE SET
        subject = excluded.subject,
        committed_at = excluded.committed_at`,
      [
        commitId,
        identity.projectId,
        identity.cloneId,
        row.sha || commitId,
        row.subject,
        null,
        `${row.commitDay}T12:00:00.000Z`,
      ],
    );
    const gitlogId = stableId('gitlog', commitId);
    database.execute(
      `INSERT INTO gitlog_entries(
        id, date, project_id, clone_id, content, collection_run_id
      ) VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET content = excluded.content`,
      [
        gitlogId,
        row.commitDay,
        identity.projectId,
        identity.cloneId,
        row.subject,
      ],
    );
    database.execute(
      `INSERT OR IGNORE INTO gitlog_entry_commits(
        gitlog_entry_id, commit_id
      ) VALUES (?, ?)`,
      [gitlogId, commitId],
    );
  }
}

function importDaily(database: Database, source: LegacySource): void {
  const daily = readLegacyDaily(source.path);
  const sourceKey = crypto
    .createHash('sha256')
    .update(path.resolve(source.path))
    .digest('hex')
    .slice(0, 16);
  const idPrefix = `legacy-daily:${sourceKey}:`;
  database.execute('DELETE FROM daily_items WHERE id LIKE ?', [
    `${idPrefix}%`,
  ]);

  const values: Array<{
    kind: 'completed' | 'ailog' | 'todo' | 'blocker' | 'note';
    content: string;
  }> = [
    ...daily.completed.map((content) => ({ kind: 'completed' as const, content })),
    ...(daily.ailog || []).map((content) => ({ kind: 'ailog' as const, content })),
    ...daily.plan.map((content) => ({ kind: 'todo' as const, content })),
    ...daily.blockers.map((content) => ({ kind: 'blocker' as const, content })),
    ...(daily.notes.trim()
      ? [{ kind: 'note' as const, content: daily.notes.trim() }]
      : []),
  ];
  const now = new Date().toISOString();
  values.forEach((value, index) => {
    database.execute(
      `INSERT INTO daily_items(
        id, date, kind, content, assignment, project_id, source,
        sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'unassigned', NULL, 'migration', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        date = excluded.date,
        kind = excluded.kind,
        content = excluded.content,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at`,
      [
        `${idPrefix}${index}`,
        daily.date,
        value.kind,
        value.content,
        index,
        now,
        now,
      ],
    );
  });
}

function importSource(database: Database, source: LegacySource): void {
  switch (source.kind) {
    case 'registry':
      importRegistry(database, source);
      break;
    case 'commits':
      importCommits(database, source);
      break;
    case 'daily':
      importDaily(database, source);
      break;
  }
}

export async function migrateLegacyData(
  database: Database,
  storageRoot: string,
): Promise<LegacyMigrationReport> {
  const report: LegacyMigrationReport = {
    imported: 0,
    skipped: 0,
    errors: [],
  };

  for (const source of discoverLegacySources(storageRoot)) {
    try {
      const fingerprint = fingerprintLegacyFile(source.path);
      if (hasImportedFingerprint(database, fingerprint)) {
        report.skipped += 1;
        continue;
      }
      database.transaction(() => {
        importSource(database, source);
        recordFingerprint(database, fingerprint);
      });
      await database.flush();
      report.imported += 1;
    } catch (error) {
      report.errors.push({
        path: source.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}
