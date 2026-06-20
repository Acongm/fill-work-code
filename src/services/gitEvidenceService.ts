import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  type CollectRequest,
  formatFillAnchorLabel,
  resolveCollectDates,
  resolveCustomRange,
  resolveFillDateRange,
} from '../utils/fillAnchor';
import type { FillPreview, FillPreviewDay, FillScope } from '../utils/types/fillPreview';
import type { DailyLog } from '../lib/workLogManager';
import type { PluginSettings } from '../features/settings/pluginSettings';
import { resolveAuthorAliasesForCollect } from '../utils/gitAuthorFilter';
import { resolveOriginFilters } from '../utils/originFilter';

export { resolveFillDateRange, resolveFillDates } from '../utils/fillAnchor';

function expandHome(inputPath: string): string {
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  if (inputPath === '~') {
    return os.homedir();
  }
  return inputPath;
}

function normalizeCommitDay(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('/')) {
    return trimmed.replace(/\//g, '-').slice(0, 10);
  }
  if (trimmed.includes('-')) {
    return trimmed.slice(0, 10);
  }
  if (trimmed.length >= 8) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  return trimmed;
}

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
  ): Promise<FillPreview> {
    const customRange = resolveCustomRange(request);
    const dates = resolveCollectDates(request);
    const monthKey = (customRange?.start ?? request.anchorDate).slice(0, 7);
    const outputDir = settings.outputDir.trim()
      ? expandHome(settings.outputDir)
      : expandHome(this.storagePath);
    const monthDir = path.join(outputDir, monthKey);
    const gitlogDir = path.join(monthDir, 'gitlog');
    fs.mkdirSync(gitlogDir, { recursive: true });

    try {
      await this.runEvidenceScript(monthKey, outputDir, settings, request, onLog);
      const artifactsSrc = path.join(monthDir, '_artifacts.tsv');
      const artifactsDest = path.join(gitlogDir, '产物清单.tsv');
      if (fs.existsSync(artifactsSrc)) {
        fs.copyFileSync(artifactsSrc, artifactsDest);
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

    const commitsPath = path.join(monthDir, '_commits.tsv');
    const dailyGitlog = {
      ...this.parseDailyGitlogMarkdown(path.join(gitlogDir, '工作日报清单.md')),
      ...this.parseGitlogFromCommits(commitsPath),
    };
    const dailyCommits = this.parseDailyCommitsFromTsv(commitsPath);
    const dailyOrigins = this.parseDailyOriginsFromCommits(commitsPath);

    const days = dates.map((date) => {
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

  private runEvidenceScript(
    monthKey: string,
    outputDir: string,
    settings: PluginSettings,
    request: CollectRequest,
    onLog?: (line: string) => void,
  ): Promise<void> {
    const scriptPath = path.join(this.extensionPath, 'scripts', 'generate-evidence.mjs');
    const bashDir = path.join(this.extensionPath, 'scripts', 'bash');
    const configPath = path.join(this.extensionPath, 'scripts', '.collect-config.json');
    const [year, month] = monthKey.split('-');
    const config = {
      month: `${year}/${month}`,
      outputDir,
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
      onLog?.(`输出目录: ${outputDir}`);
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
    for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      const cols = line.split('\t');
      if (cols.length < 9) {
        continue;
      }
      const repoName = cols[1]?.trim();
      const originUrl = cols[2]?.trim();
      const sha = cols[3]?.trim() || '';
      const commitDay = cols[5]?.trim();
      const subject = cols[8]?.trim();
      if (!commitDay || !subject) {
        continue;
      }
      const date = normalizeCommitDay(commitDay);
      if (!byDay[date]) {
        byDay[date] = [];
      }
      byDay[date].push({
        repoName: repoName || 'unknown',
        originUrl: originUrl || '',
        subject,
        sha,
      });
    }
    return byDay;
  }
}
