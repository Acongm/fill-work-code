import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { DailyLog } from '../../shared/types/dailyLog';
import { parseCommitsTsv, type ParsedCommitRow } from '../../shared/utils/parseCommitsTsv';
import type { ReposRegistry } from '../../shared/types/repoRegistry';

export type LegacySourceKind = 'registry' | 'commits' | 'daily';

export interface LegacySource {
  kind: LegacySourceKind;
  path: string;
}

export interface LegacyFingerprint {
  sourcePath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  sourceHash: string;
}

export function fingerprintLegacyFile(filePath: string): LegacyFingerprint {
  const content = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  return {
    sourcePath: path.resolve(filePath),
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    sourceHash: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

export function discoverLegacySources(storageRoot: string): LegacySource[] {
  const sources: LegacySource[] = [];
  const registryPath = path.join(storageRoot, '.repos', 'registry.json');
  if (fs.existsSync(registryPath)) {
    sources.push({ kind: 'registry', path: registryPath });
  }
  if (!fs.existsSync(storageRoot)) {
    return sources;
  }

  const monthDirectories = fs
    .readdirSync(storageRoot)
    .filter((name) => /^\d{4}-\d{2}$/.test(name))
    .sort();
  for (const month of monthDirectories) {
    const monthPath = path.join(storageRoot, month);
    const commitsPath = path.join(monthPath, '_commits.tsv');
    if (fs.existsSync(commitsPath)) {
      sources.push({ kind: 'commits', path: commitsPath });
    }
  }
  for (const month of monthDirectories) {
    const monthPath = path.join(storageRoot, month);
    for (const name of fs
      .readdirSync(monthPath)
      .filter((candidate) => /^\d{4}-\d{2}-\d{2}\.json$/.test(candidate))
      .sort()) {
      sources.push({ kind: 'daily', path: path.join(monthPath, name) });
    }
  }
  return sources;
}

export function readLegacyRegistry(filePath: string): ReposRegistry {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ReposRegistry;
  if (parsed.version !== 1 || !Array.isArray(parsed.repos)) {
    throw new Error(`Unsupported repository registry: ${filePath}`);
  }
  return parsed;
}

export function readLegacyCommits(filePath: string): ParsedCommitRow[] {
  return parseCommitsTsv(fs.readFileSync(filePath, 'utf-8'));
}

export function readLegacyDaily(filePath: string): DailyLog {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<DailyLog>;
  const date = path.basename(filePath, '.json');
  return {
    date: parsed.date || date,
    completed: Array.isArray(parsed.completed) ? parsed.completed : [],
    plan: Array.isArray(parsed.plan) ? parsed.plan : [],
    blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    gitlog: Array.isArray(parsed.gitlog) ? parsed.gitlog : [],
    ailog: Array.isArray(parsed.ailog) ? parsed.ailog : [],
    gitCommit: Array.isArray(parsed.gitCommit) ? parsed.gitCommit : [],
    origin_url: Array.isArray(parsed.origin_url) ? parsed.origin_url : [],
  };
}
