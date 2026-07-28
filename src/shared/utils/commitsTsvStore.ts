import * as fs from 'fs';
import * as path from 'path';
import { localTodayStr } from './fillAnchor';
import { normalizeCommitDay } from './dateFormat';

export interface GitEvidenceMeta {
  configHash: string;
  /** 已扫描且不可变的历史日（严格早于今天） */
  frozenDates: string[];
  updatedAt: string;
}

const META_FILE = '.runtime/git-evidence-meta.json';

export function gitEvidenceMetaPath(monthDir: string): string {
  return path.join(monthDir, META_FILE);
}

export function loadGitEvidenceMeta(monthDir: string): GitEvidenceMeta {
  const filePath = gitEvidenceMetaPath(monthDir);
  if (!fs.existsSync(filePath)) {
    return { configHash: '', frozenDates: [], updatedAt: '' };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as GitEvidenceMeta;
    return {
      configHash: raw.configHash || '',
      frozenDates: Array.isArray(raw.frozenDates) ? raw.frozenDates : [],
      updatedAt: raw.updatedAt || '',
    };
  } catch {
    return { configHash: '', frozenDates: [], updatedAt: '' };
  }
}

export function saveGitEvidenceMeta(monthDir: string, meta: GitEvidenceMeta): void {
  const filePath = gitEvidenceMetaPath(monthDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        ...meta,
        frozenDates: [...new Set(meta.frozenDates)].sort(),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf-8',
  );
}

export function parseTsvLineKey(line: string): { date: string; key: string } {
  const cols = line.split('\t');
  const date = normalizeCommitDay(cols[5] || '');
  const origin = (cols[2] || cols[0] || '').trim();
  const sha = (cols[3] || '').trim();
  return { date, key: `${origin}\0${sha}` };
}

/** 合并 TSV：保留 frozenDates 中的历史行，写入本次扫描日期的新行 */
export function mergeTsvContent(
  existingContent: string,
  incomingContent: string,
  frozenDates: Set<string>,
  scanDates: Set<string>,
): string {
  const byKey = new Map<string, string>();

  for (const line of existingContent.split(/\r?\n/).filter(Boolean)) {
    const { date, key } = parseTsvLineKey(line);
    if (frozenDates.has(date) && !scanDates.has(date)) {
      byKey.set(key, line);
    }
  }

  for (const line of incomingContent.split(/\r?\n/).filter(Boolean)) {
    const { key } = parseTsvLineKey(line);
    byKey.set(key, line);
  }

  const lines = [...byKey.values()];
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

export function datesNeedingScan(
  dates: string[],
  meta: GitEvidenceMeta,
  configHash: string,
  forceRescan: boolean,
): string[] {
  if (forceRescan) {
    return dates;
  }
  if (meta.configHash && meta.configHash !== configHash) {
    return dates;
  }
  const today = localTodayStr();
  const frozen = new Set(meta.frozenDates);
  return dates.filter((date) => {
    if (date >= today) {
      return true;
    }
    return !frozen.has(date);
  });
}

export function markFrozenDates(
  meta: GitEvidenceMeta,
  scannedDates: string[],
  configHash: string,
): GitEvidenceMeta {
  const today = localTodayStr();
  const frozen = new Set(meta.frozenDates);
  for (const date of scannedDates) {
    if (date < today) {
      frozen.add(date);
    }
  }
  return {
    configHash,
    frozenDates: [...frozen].sort(),
    updatedAt: new Date().toISOString(),
  };
}

export function historicalDatesFrozen(
  dates: string[],
  meta: GitEvidenceMeta,
  configHash: string,
): boolean {
  const today = localTodayStr();
  const historical = dates.filter((date) => date < today);
  if (historical.length === 0) {
    return false;
  }
  if (meta.configHash !== configHash) {
    return false;
  }
  const frozen = new Set(meta.frozenDates);
  return historical.every((date) => frozen.has(date));
}
