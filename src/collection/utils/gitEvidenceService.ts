import { spawn, type ChildProcess } from 'node:child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  type CollectRequest,
  formatFillAnchorLabel,
  narrowCollectRequestToDates,
  resolveCollectDates,
  resolveCustomRange,
  resolveFillDateRange,
} from '../../shared/utils/fillAnchor';
import type { FillPreview, FillPreviewDay } from '../../shared/types/fillPreview';
import type { DailyLog } from '../../daily/utils/workLogManager';
import type { PluginSettings } from '../../settings/types/pluginSettings';
import type { Database } from '../../database/types/database';
import { resolveAuthorAliasesForCollect } from '../../shared/utils/gitAuthorFilter';
import { resolveOriginFilters } from '../../shared/utils/originFilter';
import { parseCommitsTsv } from '../../shared/utils/parseCommitsTsv';
import { dedupeCommitsBySha } from '../../shared/utils/dedupeCommits';
import { loadRegistry, getKnownRepoRoots } from '../../shared/utils/repoRegistry';
import {
  buildFillCacheSearchConfig,
  fillCacheConfigHash,
  monthKeysForDates,
} from './fillCacheService';
import {
  datesNeedingScan,
  loadGitEvidenceMeta,
  markFrozenDates,
  mergeTsvContent,
  saveGitEvidenceMeta,
} from '../../shared/utils/commitsTsvStore';
import { resolveRuntimePaths } from '../../settings/utils/pathUtils';
import { evidenceTsvToFacts } from './evidenceToFacts';
import { applyCollection } from '../commands/applyCollection';
import { CollectionRepository } from '../../database/commands/collectionRepository';
import { normalizeCommitDay } from '../../shared/utils/dateFormat';

export { resolveFillDateRange, resolveFillDates } from '../../shared/utils/fillAnchor';

export class GitEvidenceService {
  private activeChild: ChildProcess | null = null;

  constructor(
    private readonly extensionPath: string,
    private readonly storagePath: string,
  ) {}

  cancelActiveCollect(): void {
    if (this.activeChild) {
      this.activeChild.kill('SIGTERM');
      this.activeChild = null;
    }
  }

  /** 从 _commits.tsv 补全月度列表中的 gitlog（汇总页展示） */
  enrichLogsFromCommits(monthDir: string, logs: DailyLog[]): DailyLog[] {
    const commitsPath = path.join(monthDir, '_commits.tsv');
    const dailyGitlog = this.parseGitlogFromCommits(commitsPath);
    const dailyCommits = this.parseDailyCommitsFromTsv(commitsPath);
    const dailyOrigins = this.parseDailyOriginsFromCommits(commitsPath);
    return logs.map((log) => ({
      ...log,
      gitlog:
        (log.gitlog && log.gitlog.length > 0 ? log.gitlog : dailyGitlog[log.date]) ||
        [],
      gitCommit:
        (log.gitCommit && log.gitCommit.length > 0
          ? log.gitCommit
          : dailyCommits[log.date]) || [],
      origin_url:
        (log.origin_url && log.origin_url.length > 0
          ? log.origin_url
          : dailyOrigins[log.date]) || [],
    }));
  }

  async collect(
    request: CollectRequest,
    settings: PluginSettings,
    existingLogs: Record<string, DailyLog | null>,
    onLog?: (line: string) => void,
    database?: Database,
  ): Promise<FillPreview> {
    const dates = resolveCollectDates(request);
    const storageRoot = resolveRuntimePaths(this.storagePath).root;
    const searchConfig = buildFillCacheSearchConfig(settings);
    const configHash = fillCacheConfigHash(searchConfig);
    const forceRescan = request.forceRescan ?? false;
    const monthKeys = monthKeysForDates(dates);
    const compatibilityWarnings: string[] = [];

    try {
      for (const monthKey of monthKeys) {
        const monthDates = dates.filter((date) => date.startsWith(monthKey));
        const monthDir = path.join(storageRoot, monthKey);
        const gitlogDir = path.join(monthDir, 'gitlog');
        fs.mkdirSync(gitlogDir, { recursive: true });

        const commitsPath = path.join(monthDir, '_commits.tsv');
        const meta = loadGitEvidenceMeta(monthDir);
        const needing = datesNeedingScan(monthDates, meta, configHash, forceRescan);
        const existingContent = fs.existsSync(commitsPath)
          ? fs.readFileSync(commitsPath, 'utf-8')
          : '';

        if (needing.length === 0) {
          onLog?.(
            `[TSV 缓存] ${monthKey} 范围内 ${monthDates.length} 天均已冻结，跳过 Git 扫描`,
          );
          if (database && existingContent.trim()) {
            // 冻结跳过扫描时仍把已有 TSV 同步进 SQLite，避免「我的仓库」空窗
            const warnings = await this.persistEvidenceToSqlite(
              database,
              storageRoot,
              existingContent,
              undefined,
              request,
              onLog,
            );
            compatibilityWarnings.push(...warnings);
          }
          continue;
        }

        const frozenCount = monthDates.length - needing.length;
        if (frozenCount > 0) {
          onLog?.(
            `[TSV 缓存] ${monthKey} 复用 ${frozenCount} 天冻结数据，增量扫描: ${needing.join(', ')}`,
          );
        }

        const scanRequest = narrowCollectRequestToDates(request, needing);
        await this.runEvidenceScript(monthKey, storageRoot, settings, scanRequest, onLog);

        const incomingContent = fs.existsSync(commitsPath)
          ? fs.readFileSync(commitsPath, 'utf-8')
          : '';
        const frozenSet =
          !forceRescan && meta.configHash === configHash
            ? new Set(meta.frozenDates)
            : new Set<string>();
        const scanSet = new Set(needing);
        const merged = mergeTsvContent(existingContent, incomingContent, frozenSet, scanSet);

        if (database) {
          // 权威写入：先 SQLite（含冻结合并行），再由 CompatibilityWriter 双写 TSV/registry
          const warnings = await this.persistEvidenceToSqlite(
            database,
            storageRoot,
            merged,
            undefined,
            request,
            onLog,
          );
          compatibilityWarnings.push(...warnings);
        } else {
          fs.writeFileSync(commitsPath, merged, 'utf-8');
          onLog?.(`[兼容] 无数据库实例，仅写入 staging TSV`);
        }

        const updatedMeta = markFrozenDates(meta, needing, configHash);
        saveGitEvidenceMeta(monthDir, updatedMeta);

        const artifactsSrc = path.join(monthDir, '_artifacts.tsv');
        const artifactsDest = path.join(gitlogDir, '产物清单.tsv');
        if (fs.existsSync(artifactsSrc)) {
          fs.copyFileSync(artifactsSrc, artifactsDest);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog?.(`采集失败: ${message}`);
      return {
        scope: request.scope,
        anchorDate: request.anchorDate,
        rangeStart: request.rangeStart,
        rangeEnd: request.rangeEnd,
        dates,
        days: dates.map((date) => this.emptyDay(date, existingLogs, [`采集失败: ${message}`])),
        error: message,
      };
    }

    for (const warning of compatibilityWarnings) {
      onLog?.(`[双写警告] ${warning}`);
    }

    const days = this.buildDaysFromCommits(dates, storageRoot, existingLogs);

    return {
      scope: request.scope,
      anchorDate: request.anchorDate,
      rangeStart: request.rangeStart,
      rangeEnd: request.rangeEnd,
      dates,
      days,
      collectedAt: new Date().toISOString(),
    };
  }

  async ensureStructuredEvidence(
    request: CollectRequest,
    database: Database,
    onLog?: (line: string) => void,
  ): Promise<{ hydrated: boolean; missingMonths: string[] }> {
    const dates = resolveCollectDates(request);
    const storageRoot = resolveRuntimePaths(this.storagePath).root;
    const missingMonths: string[] = [];
    let hydrated = false;

    for (const monthKey of monthKeysForDates(dates)) {
      const commitsPath = path.join(storageRoot, monthKey, '_commits.tsv');
      if (!fs.existsSync(commitsPath)) {
        missingMonths.push(monthKey);
        continue;
      }
      const content = fs.readFileSync(commitsPath, 'utf-8');
      const monthDates = new Set(
        dates.filter((date) => date.startsWith(monthKey)),
      );
      if (content.trim()) {
        await this.persistEvidenceToSqlite(
          database,
          storageRoot,
          content,
          monthDates,
          request,
          onLog,
        );
      } else {
        onLog?.(`[SQLite] ${monthKey} 采集结果为空，无 Commit 需要写入`);
      }
      hydrated = true;
    }

    return { hydrated, missingMonths };
  }

  private async persistEvidenceToSqlite(
    database: Database,
    storageRoot: string,
    tsvContent: string,
    dates: Set<string> | undefined,
    request: CollectRequest,
    onLog?: (line: string) => void,
  ): Promise<string[]> {
    const collectionRunId = `run:${crypto.randomUUID()}`;
    const collection = new CollectionRepository(database);
    await collection.upsertRun({
      id: collectionRunId,
      scope: request.scope,
      anchorDate: request.anchorDate,
      rangeStart: request.rangeStart ?? null,
      rangeEnd: request.rangeEnd ?? null,
      status: 'running',
    });

    try {
      const facts = evidenceTsvToFacts(database, tsvContent, {
        dates,
        collectionRunId,
      });
      onLog?.(
        `[SQLite] 写入 ${facts.commits.length} 条 commit / ${facts.projectCount} 个项目`,
      );
      if (facts.commits.length === 0) {
        await collection.finishRun(collectionRunId, 'completed');
        return [];
      }
      const { warnings } = await applyCollection(database, storageRoot, {
        commits: facts.commits,
        gitlogEntries: facts.gitlogEntries,
      });
      await collection.finishRun(collectionRunId, 'completed');
      onLog?.(`[双写] 已从 SQLite 导出兼容 _commits.tsv / registry.json`);
      return warnings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await collection.finishRun(collectionRunId, 'failed', message);
      throw error;
    }
  }

  private buildDaysFromCommits(
    dates: string[],
    storageRoot: string,
    existingLogs: Record<string, DailyLog | null>,
  ): FillPreviewDay[] {
    const monthKeys = monthKeysForDates(dates);
    let dailyGitlog: Record<string, string[]> = {};
    let dailyCommits: Record<string, string[]> = {};
    let dailyOrigins: Record<string, string[]> = {};

    for (const monthKey of monthKeys) {
      const monthDir = path.join(storageRoot, monthKey);
      const commitsPath = path.join(monthDir, '_commits.tsv');
      const gitlogDir = path.join(monthDir, 'gitlog');
      dailyGitlog = {
        ...this.parseDailyGitlogMarkdown(path.join(gitlogDir, '工作日报清单.md')),
        ...dailyGitlog,
        ...this.parseGitlogFromCommits(commitsPath),
      };
      dailyCommits = { ...dailyCommits, ...this.parseDailyCommitsFromTsv(commitsPath) };
      dailyOrigins = { ...dailyOrigins, ...this.parseDailyOriginsFromCommits(commitsPath) };
    }

    return dates.map((date) => {
      const existing = existingLogs[date];
      const warnings: string[] = [];
      const gitlog = dailyGitlog[date] || [];
      const gitCommit = dailyCommits[date] || [];
      const originUrl = dailyOrigins[date] || [];
      if (gitlog.length === 0 && gitCommit.length === 0) {
        warnings.push('当日无 Git 提交记录');
      }
      return {
        date,
        completed: existing?.completed || [],
        gitlog,
        gitCommit,
        originUrl,
        ailogDraft: existing?.ailog || [],
        warnings,
      };
    });
  }

  private runEvidenceScript(
    monthKey: string,
    storageRoot: string,
    settings: PluginSettings,
    request: CollectRequest,
    onLog?: (line: string) => void,
  ): Promise<void> {
    const scriptPath = path.join(this.extensionPath, 'scripts', 'generate-evidence.mjs');
    const bashDir = path.join(this.extensionPath, 'scripts', 'bash');
    const runtimeDir = resolveRuntimePaths(storageRoot).runtime;
    fs.mkdirSync(runtimeDir, { recursive: true });
    const configPath = path.join(runtimeDir, 'collect-config.json');
    const registry = loadRegistry(storageRoot);
    const knownRepoRoots = getKnownRepoRoots(registry);
    const [year, month] = monthKey.split('-');
    const config = {
      month: `${year}/${month}`,
      storageRoot,
      skillScriptsDir: bashDir,
      searchRoots: settings.searchRoots,
      originFilters: resolveOriginFilters(settings),
      displayName: settings.displayName,
      authorAliases: resolveAuthorAliasesForCollect({
        authorAliases: settings.authorAliases,
        displayName: settings.displayName,
      }),
      anchorDate: request.anchorDate,
      fillScope: request.scope,
      ...(() => {
        const customRange = resolveCustomRange(request);
        const range = resolveFillDateRange(request.scope, request.anchorDate, customRange);
        return {
          dateRangeStart: range.startDate,
          dateRangeEnd: range.endDate,
          targetDates: range.dates,
        };
      })(),
      knownRepoRoots,
      gitLogConcurrency: settings.gitLogConcurrency ?? 4,
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    return new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [scriptPath, '--config', configPath, '--evidence-only'],
        { cwd: this.extensionPath, env: { ...process.env, FORCE_COLOR: '0' } },
      );
      this.activeChild = child;
      let stderrBuf = '';
      const append = (chunk: Buffer, isErr = false) => {
        const text = chunk.toString('utf-8');
        if (isErr) {
          stderrBuf += text;
        }
        const parts = text.split(/\r?\n/);
        for (const line of parts) {
          if (line.trim()) {
            onLog?.(line);
          }
        }
      };
      const customRange = resolveCustomRange(request);
      const range = resolveFillDateRange(request.scope, request.anchorDate, customRange);
      const scopeLabel =
        request.scope === 'workWeek'
          ? '本周'
          : request.scope === 'custom'
            ? '自定义'
            : '单日';
      onLog?.(`启动: generate-evidence.mjs --evidence-only`);
      onLog?.(
        `证据月份: ${monthKey} | ${scopeLabel} · ${formatFillAnchorLabel(request.scope, request.anchorDate, customRange)}`,
      );
      onLog?.(`扫描窗口: ${range.startDate} ~ ${range.endDate}（仅导出该区间内 commit）`);
      onLog?.(`目标写入日: ${range.dates.join(', ')}`);
      onLog?.(`存储目录: ${storageRoot}`);
      child.stdout.on('data', (c) => append(c, false));
      child.stderr.on('data', (c) => append(c, true));
      child.on('error', (err) => {
        this.activeChild = null;
        reject(err);
      });
      child.on('close', (code, signal) => {
        this.activeChild = null;
        if (signal === 'SIGTERM') {
          reject(new Error('采集已取消'));
          return;
        }
        if (code === 0) {
          resolve();
        } else {
          const detail = stderrBuf.trim() ? `\n${stderrBuf.trim()}` : '';
          reject(new Error(`generate-evidence 退出码 ${code ?? 'unknown'}${detail}`));
        }
      });
    });
  }

  private emptyDay(
    date: string,
    existingLogs: Record<string, DailyLog | null>,
    warnings: string[],
  ): FillPreviewDay {
    const existing = existingLogs[date];
    return {
      date,
      completed: existing?.completed || [],
      gitlog: [],
      gitCommit: [],
      originUrl: [],
      ailogDraft: existing?.ailog || [],
      warnings,
    };
  }

  private parseDailyGitlogMarkdown(filePath: string): Record<string, string[]> {
    const daily: Record<string, string[]> = {};
    if (!fs.existsSync(filePath)) {
      return daily;
    }
    let currentDate = '';
    for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      const match = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
      if (match) {
        currentDate = `${match[1]}-${match[2]}-${match[3]}`;
        daily[currentDate] = daily[currentDate] || [];
        continue;
      }
      if (currentDate && trimmed.startsWith('- ')) {
        const item = trimmed.slice(2).trim();
        if (item) {
          daily[currentDate].push(item);
        }
      }
    }
    return daily;
  }

  /** 从 _commits.tsv 按日生成 GitLog 行（与脚本 Step7 逻辑一致，不写正式 JSON） */
  private parseGitlogFromCommits(filePath: string): Record<string, string[]> {
    const daily: Record<string, string[]> = {};
    if (!fs.existsSync(filePath)) {
      return daily;
    }
    const dayCommits = this.readCommitsByDay(filePath);
    for (const [date, commits] of Object.entries(dayCommits)) {
      const repoGroups = new Map<string, string[]>();
      for (const c of commits) {
        if (!repoGroups.has(c.repoName)) {
          repoGroups.set(c.repoName, []);
        }
        if (!repoGroups.get(c.repoName)!.includes(c.subject)) {
          repoGroups.get(c.repoName)!.push(c.subject);
        }
      }
      const lines: string[] = [];
      for (const [repo, subjects] of repoGroups) {
        if (subjects.length === 1) {
          lines.push(`[${repo}] ${subjects[0]}`);
        } else {
          lines.push(`[${repo}] ${subjects.join('；')}`);
        }
      }
      if (lines.length > 0) {
        daily[date] = lines;
      }
    }
    return daily;
  }

  private parseDailyCommitsFromTsv(filePath: string): Record<string, string[]> {
    const daily: Record<string, string[]> = {};
    const dayCommits = this.readCommitsByDay(filePath);
    for (const [date, commits] of Object.entries(dayCommits)) {
      daily[date] = commits.map((c) => {
        const shortSha = c.sha ? c.sha.slice(0, 8) : '';
        return shortSha ? `${shortSha} ${c.subject}` : c.subject;
      }).filter(Boolean);
    }
    return daily;
  }

  private parseDailyOriginsFromCommits(filePath: string): Record<string, string[]> {
    const daily: Record<string, Set<string>> = {};
    const dayCommits = this.readCommitsByDay(filePath);
    for (const [date, commits] of Object.entries(dayCommits)) {
      if (!daily[date]) {
        daily[date] = new Set();
      }
      for (const c of commits) {
        if (c.originUrl && (c.originUrl.startsWith('http') || c.originUrl.includes('.git'))) {
          daily[date].add(c.originUrl);
        }
      }
    }
    const result: Record<string, string[]> = {};
    for (const [date, set] of Object.entries(daily)) {
      result[date] = [...set];
    }
    return result;
  }

  private readCommitsByDay(filePath: string): Record<
    string,
    Array<{ repoName: string; originUrl: string; subject: string; sha: string }>
  > {
    const byDay: Record<
      string,
      Array<{ repoName: string; originUrl: string; subject: string; sha: string }>
    > = {};
    if (!fs.existsSync(filePath)) {
      return byDay;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const deduped = dedupeCommitsBySha(parseCommitsTsv(content));
    for (const row of deduped) {
      const date = normalizeCommitDay(row.commitDay);
      if (!byDay[date]) {
        byDay[date] = [];
      }
      byDay[date].push({
        repoName: row.repoName || 'unknown',
        originUrl: row.originUrl || '',
        subject: row.subject,
        sha: row.sha,
      });
    }
    return byDay;
  }
}
