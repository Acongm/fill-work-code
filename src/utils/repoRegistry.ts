import * as fs from 'fs';
import * as path from 'path';
import type { ParsedCommitRow } from './parseCommitsTsv';
import { parseCommitsTsv, uniqueReposFromRows } from './parseCommitsTsv';
import {
  defaultCloneLabel,
  emptyRegistry,
  repoIdFromRoot,
  type RepoGroup,
  type RepoRecord,
  type ReposRegistry,
} from './types/repoRegistry';

const REGISTRY_DIR = '.repos';
const REGISTRY_FILE = 'registry.json';

export function registryPath(storagePath: string): string {
  return path.join(storagePath, REGISTRY_DIR, REGISTRY_FILE);
}

export function loadRegistry(storagePath: string): ReposRegistry {
  const filePath = registryPath(storagePath);
  if (!fs.existsSync(filePath)) {
    return emptyRegistry();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ReposRegistry;
    if (raw.version === 1 && Array.isArray(raw.repos)) {
      return raw;
    }
  } catch {
    /* fall through */
  }
  return emptyRegistry();
}

export function saveRegistry(storagePath: string, registry: ReposRegistry): void {
  const filePath = registryPath(storagePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next: ReposRegistry = {
    ...registry,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf-8');
}

export function diffDiscoveredRepos(
  discoveredRoots: string[],
  registry: ReposRegistry,
): { known: string[]; newPaths: string[] } {
  const knownSet = new Set(registry.repos.map((r) => r.repoRoot));
  const known: string[] = [];
  const newPaths: string[] = [];
  for (const root of discoveredRoots) {
    if (knownSet.has(root)) {
      known.push(root);
    } else {
      newPaths.push(root);
    }
  }
  return { known, newPaths };
}

export function getKnownRepoRoots(registry: ReposRegistry): string[] {
  return registry.repos.filter((r) => !r.hidden).map((r) => r.repoRoot);
}

function upsertRepoRecord(
  registry: ReposRegistry,
  repoRoot: string,
  repoName: string,
  originUrl: string,
  lastCommitAt?: string,
  commitDelta = 0,
): ReposRegistry {
  const now = new Date().toISOString();
  const id = repoIdFromRoot(repoRoot);
  const idx = registry.repos.findIndex((r) => r.id === id);
  if (idx >= 0) {
    const prev = registry.repos[idx];
    const updated: RepoRecord = {
      ...prev,
      repoName: repoName || prev.repoName,
      originUrl: originUrl || prev.originUrl,
      lastScannedAt: now,
      lastCommitAt: lastCommitAt || prev.lastCommitAt,
      commitCountTotal: prev.commitCountTotal + commitDelta,
      scanMissCount: 0,
    };
    const repos = [...registry.repos];
    repos[idx] = updated;
    return { ...registry, repos };
  }
  const record: RepoRecord = {
    id,
    repoRoot,
    repoName,
    originUrl,
    cloneLabel: defaultCloneLabel(repoRoot),
    firstSeenAt: now,
    lastScannedAt: now,
    lastCommitAt,
    commitCountTotal: commitDelta,
    pinned: false,
    hidden: false,
    scanMissCount: 0,
  };
  return { ...registry, repos: [...registry.repos, record] };
}

export function upsertFromTsv(storagePath: string, commitsTsvPath: string): ReposRegistry {
  let registry = loadRegistry(storagePath);
  if (!fs.existsSync(commitsTsvPath)) {
    return registry;
  }
  const content = fs.readFileSync(commitsTsvPath, 'utf-8');
  const rows = parseCommitsTsv(content);
  const repos = uniqueReposFromRows(rows);
  const commitsByRoot = new Map<string, ParsedCommitRow[]>();
  for (const row of rows) {
    if (!commitsByRoot.has(row.repoRoot)) {
      commitsByRoot.set(row.repoRoot, []);
    }
    commitsByRoot.get(row.repoRoot)!.push(row);
  }
  for (const repo of repos) {
    const repoRows = commitsByRoot.get(repo.repoRoot) || [];
    let lastCommitAt: string | undefined;
    for (const r of repoRows) {
      if (!lastCommitAt || r.commitDay > lastCommitAt) {
        lastCommitAt = r.commitDay;
      }
    }
    registry = upsertRepoRecord(
      registry,
      repo.repoRoot,
      repo.repoName,
      repo.originUrl,
      lastCommitAt,
      repoRows.length,
    );
  }
  saveRegistry(storagePath, registry);
  return registry;
}

export function groupReposByOrigin(registry: ReposRegistry): RepoGroup[] {
  const map = new Map<string, RepoRecord[]>();
  for (const repo of registry.repos) {
    const key = repo.originUrl || repo.repoRoot;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(repo);
  }
  const groups: RepoGroup[] = [];
  for (const [originUrl, clones] of map) {
    const sorted = [...clones].sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return (b.lastCommitAt || '').localeCompare(a.lastCommitAt || '');
    });
    groups.push({
      originUrl,
      repoName: sorted[0]?.repoName || originUrl,
      clones: sorted,
      lastCommitAt: sorted[0]?.lastCommitAt,
      cloneCount: sorted.length,
    });
  }
  return groups.sort((a, b) => (b.lastCommitAt || '').localeCompare(a.lastCommitAt || ''));
}

export function listRepoGroups(
  registry: ReposRegistry,
  filter?: { search?: string; includeHidden?: boolean },
): RepoGroup[] {
  let groups = groupReposByOrigin(registry);
  if (!filter?.includeHidden) {
    groups = groups
      .map((g) => ({
        ...g,
        clones: g.clones.filter((c) => !c.hidden),
        cloneCount: g.clones.filter((c) => !c.hidden).length,
      }))
      .filter((g) => g.cloneCount > 0);
  }
  const q = filter?.search?.trim().toLowerCase();
  if (q) {
    groups = groups.filter(
      (g) =>
        g.repoName.toLowerCase().includes(q) ||
        g.originUrl.toLowerCase().includes(q) ||
        g.clones.some((c) => c.repoRoot.toLowerCase().includes(q)),
    );
  }
  return groups;
}

export function getRepoById(registry: ReposRegistry, id: string): RepoRecord | undefined {
  return registry.repos.find((r) => r.id === id);
}

export function getRepoGroupByOrigin(
  registry: ReposRegistry,
  originUrl: string,
): RepoGroup | undefined {
  return groupReposByOrigin(registry).find((g) => g.originUrl === originUrl);
}

export function updateRepoFlags(
  registry: ReposRegistry,
  id: string,
  flags: { pinned?: boolean; hidden?: boolean },
): ReposRegistry {
  const repos = registry.repos.map((r) =>
    r.id === id ? { ...r, ...flags } : r,
  );
  return { ...registry, repos };
}

export interface RepoActivityCommit {
  date: string;
  sha: string;
  subject: string;
  repoRoot: string;
  repoName: string;
}

export interface RepoActivity {
  commits: RepoActivityCommit[];
  gitlogLines: Array<{ date: string; line: string }>;
  ailogLines: Array<{ date: string; line: string }>;
}

export function aggregateRepoActivity(
  storagePath: string,
  group: RepoGroup,
  options?: { cloneId?: string; month?: string },
): RepoActivity {
  const cloneIds = new Set(
    options?.cloneId
      ? [options.cloneId]
      : group.clones.map((c) => c.id),
  );
  const cloneRoots = new Set(
    group.clones.filter((c) => cloneIds.has(c.id)).map((c) => c.repoRoot),
  );
  const originSet = new Set([group.originUrl]);
  const repoCommitDates = new Set<string>();
  const commits: RepoActivityCommit[] = [];
  const gitlogLines: Array<{ date: string; line: string }> = [];
  const ailogLines: Array<{ date: string; line: string }> = [];

  const month = options?.month;
  const monthDirs = month
    ? [path.join(storagePath, month)]
    : fs.existsSync(storagePath)
      ? fs
          .readdirSync(storagePath)
          .filter((d) => /^\d{4}-\d{2}$/.test(d))
          .map((d) => path.join(storagePath, d))
      : [];

  for (const monthDir of monthDirs) {
    const tsvPath = path.join(monthDir, '_commits.tsv');
    if (fs.existsSync(tsvPath)) {
      const rows = parseCommitsTsv(fs.readFileSync(tsvPath, 'utf-8'));
      for (const row of rows) {
        if (
          cloneRoots.has(row.repoRoot) ||
          (row.originUrl && originSet.has(row.originUrl))
        ) {
          if (options?.cloneId && !cloneRoots.has(row.repoRoot)) {
            continue;
          }
          const commitDate = row.commitDay.slice(0, 10);
          repoCommitDates.add(commitDate);
          commits.push({
            date: commitDate,
            sha: row.sha,
            subject: row.subject,
            repoRoot: row.repoRoot,
            repoName: row.repoName,
          });
        }
      }
    }
    const files = fs.readdirSync(monthDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
    for (const file of files) {
      const date = file.replace('.json', '');
      try {
        const log = JSON.parse(
          fs.readFileSync(path.join(monthDir, file), 'utf-8'),
        ) as {
          origin_url?: string[];
          gitlog?: string[];
          ailog?: string[];
        };
        const origins = log.origin_url || [];
        const matchOrigin = origins.some((o) => originSet.has(o));
        const hasRepoCommitOnDate = repoCommitDates.has(date);
        const relatedToRepo = matchOrigin || hasRepoCommitOnDate;
        if (!relatedToRepo) {
          continue;
        }
        for (const line of log.gitlog || []) {
          if (line.includes(`[${group.repoName}]`) || relatedToRepo) {
            gitlogLines.push({ date, line });
          }
        }
        if ((log.ailog || []).length > 0) {
          for (const line of log.ailog || []) {
            ailogLines.push({ date, line });
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  const seenSha = new Set<string>();
  const dedupedCommits = commits.filter((c) => {
    const k = c.sha || `${c.date}:${c.subject}`;
    if (seenSha.has(k)) {
      return false;
    }
    seenSha.add(k);
    return true;
  });

  const sortByDateDesc = <T extends { date: string }>(items: T[]): T[] =>
    [...items].sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) {
        return byDate;
      }
      return 0;
    });

  return {
    commits: dedupedCommits.sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) {
        return byDate;
      }
      return b.sha.localeCompare(a.sha);
    }),
    gitlogLines: sortByDateDesc(gitlogLines),
    ailogLines: sortByDateDesc(ailogLines),
  };
}
