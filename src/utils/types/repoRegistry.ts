import * as crypto from 'crypto';

export interface RepoRecord {
  id: string;
  repoRoot: string;
  repoName: string;
  originUrl: string;
  cloneLabel: string;
  firstSeenAt: string;
  lastScannedAt: string;
  lastCommitAt?: string;
  commitCountTotal: number;
  pinned: boolean;
  hidden: boolean;
  scanMissCount: number;
}

export interface RepoGroup {
  originUrl: string;
  repoName: string;
  clones: RepoRecord[];
  lastCommitAt?: string;
  cloneCount: number;
}

export interface ReposRegistry {
  version: 1;
  updatedAt: string;
  repos: RepoRecord[];
}

export function repoIdFromRoot(repoRoot: string): string {
  return crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
}

export function defaultCloneLabel(repoRoot: string): string {
  const parts = repoRoot.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || repoRoot;
}

export function emptyRegistry(): ReposRegistry {
  return { version: 1, updatedAt: new Date().toISOString(), repos: [] };
}
