import * as crypto from 'crypto';
import * as path from 'path';
import type { Database } from '../types/database';

export interface ProjectIdentity {
  projectId: string;
  cloneId: string;
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}:${crypto
    .createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 24)}`;
}

export function ensureProjectAndClone(
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
