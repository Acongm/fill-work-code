import * as path from 'path';
import type { Database } from '../../database/types/database';

export interface ConversationProjectMatch {
  projectId: string;
  cloneId: string;
}

export function matchConversationProject(
  database: Database,
  cwd?: string,
): ConversationProjectMatch | undefined {
  if (!cwd) {
    return undefined;
  }
  const normalizedCwd = path.resolve(cwd);
  const clones = database.all<{
    id: string;
    project_id: string;
    repo_root: string;
  }>('SELECT id, project_id, repo_root FROM project_clones');
  return clones
    .map((clone) => ({ ...clone, normalized: path.resolve(clone.repo_root) }))
    .filter(
      (clone) =>
        normalizedCwd === clone.normalized ||
        normalizedCwd.startsWith(`${clone.normalized}${path.sep}`),
    )
    .sort((a, b) => b.normalized.length - a.normalized.length)
    .map((clone) => ({
      projectId: clone.project_id,
      cloneId: clone.id,
    }))[0];
}
