import type { DailyLog } from '../../daily/utils/workLogManager';
import {
  type CollectRequest,
  formatFillAnchorLabel,
  formatFillScopeAnchorTitle,
  localTodayStr,
  resolveCollectDates,
  resolveCustomRange,
  resolveFillDateRange,
} from '../../shared/utils/fillAnchor';
import {
  buildFillCacheSearchConfig,
  monthKeysForDates,
} from '../utils/fillCacheService';
import type { FillPreview, FillScope } from '../../shared/types/fillPreview';
import * as vscode from 'vscode';
import type { HostPanelDeps } from '../../app/types/hostDependencies';
import { invalidateRepositoryOptionsCache } from '../../shared/utils/listRepositoryOptions';
import { loadPluginSettings } from '../../settings/commands/settingsMessages';
import { handleListRepos } from '../../projects/commands/projectMessages';
import type { PluginSettings } from '../../settings/types/pluginSettings';
import {
  applyGitPreview,
  requestForGitPreview,
} from './applyGitPreview';
import { savePolishedCompleted } from './savePolishedCompleted';

function postCollectLog(deps: HostPanelDeps, line: string, runId?: number): void {
  if (runId !== undefined && runId !== deps.state.collectRunId) {
    return;
  }
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const formatted = `[${ts}] ${line}`;
  deps.outputChannel.appendLine(formatted);
  deps.postToWebview({ command: 'collectLogAppend', line: formatted });
}

async function collectGitEvidence(
  deps: HostPanelDeps,
  request: CollectRequest,
  settings: PluginSettings,
  existingLogs: Record<string, DailyLog | null>,
  runId: number,
): Promise<FillPreview> {
  const preview = await deps.gitEvidenceService.collect(
    request,
    settings,
    existingLogs,
    (line) => postCollectLog(deps, line, runId),
    deps.database,
  );
  if (!preview.error) {
    try {
      await handleListRepos(deps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      postCollectLog(deps, `[仓库列表] 刷新失败: ${message}`, runId);
    }
  }
  return preview;
}

export function parseCollectRequest(data: {
  scope: FillScope;
  anchorDate: string;
  rangeStart?: string;
  rangeEnd?: string;
  forceRescan?: boolean;
}): CollectRequest {
  return {
    scope: data.scope,
    anchorDate: data.anchorDate,
    rangeStart: data.rangeStart,
    rangeEnd: data.rangeEnd,
    forceRescan: !!data.forceRescan,
  };
}

export function cancelCollect(deps: HostPanelDeps): void {
  deps.state.collectRunId += 1;
  deps.gitEvidenceService.cancelActiveCollect();
  deps.postToWebview({
    command: 'collectLogEnd',
    cancelled: true,
    error: '已取消采集',
  });
}

function collectMonthKey(request: CollectRequest): string {
  const custom = resolveCustomRange(request);
  return (custom?.start ?? request.anchorDate).slice(0, 7);
}

function fillCacheLookup(request: CollectRequest): FillPreview {
  return {
    scope: request.scope,
    anchorDate: request.anchorDate,
    rangeStart: request.rangeStart,
    rangeEnd: request.rangeEnd,
    dates: [],
    days: [],
  };
}

function cacheCoversDates(cached: FillPreview, dates: string[]): boolean {
  const cachedDates = new Set(cached.days.map((day) => day.date));
  return dates.every((date) => cachedDates.has(date));
}

function normalizeCachedPreview(
  request: CollectRequest,
  dates: string[],
  cached: FillPreview,
): FillPreview {
  const dayByDate = new Map(cached.days.map((day) => [day.date, day]));
  return {
    ...cached,
    scope: request.scope,
    anchorDate: request.anchorDate,
    rangeStart: request.rangeStart ?? cached.rangeStart,
    rangeEnd: request.rangeEnd ?? cached.rangeEnd,
    dates,
    days: dates.map(
      (date) =>
        dayByDate.get(date) ?? {
          date,
          completed: [],
          gitlog: [],
          gitCommit: [],
          originUrl: [],
          ailogDraft: [],
          warnings: [],
        },
    ),
    source: 'git',
  };
}

function loadGitPreviewFromCache(
  deps: HostPanelDeps,
  request: CollectRequest,
  dates: string[],
  settings: Awaited<ReturnType<typeof loadPluginSettings>>,
): FillPreview | null {
  if (!settings.gitCollectCacheEnabled || request.forceRescan) {
    return null;
  }

  const monthKeys = monthKeysForDates(dates);
  const cacheSearchConfig = buildFillCacheSearchConfig(settings);
  const cacheLookup = fillCacheLookup(request);
  const { startDate, endDate } = resolveFillDateRange(
    request.scope,
    request.anchorDate,
    resolveCustomRange(request),
  );

  for (const monthKey of monthKeys) {
    const exact = deps.fillCacheService.load(
      monthKey,
      cacheLookup,
      cacheSearchConfig,
    );
    if (exact && cacheCoversDates(exact, dates)) {
      return normalizeCachedPreview(request, dates, exact);
    }
  }

  const ranged = deps.fillCacheService.loadByDateRange(
    monthKeys,
    startDate,
    endDate,
    cacheSearchConfig,
  );
  if (ranged && cacheCoversDates(ranged, dates)) {
    return normalizeCachedPreview(request, dates, ranged);
  }

  const assembled = deps.fillCacheService.assembleForDates(
    monthKeys,
    dates,
    cacheSearchConfig,
  );
  if (assembled && cacheCoversDates(assembled, dates)) {
    return normalizeCachedPreview(request, dates, assembled);
  }

  return null;
}

function previewHasGitEvidence(preview: FillPreview): boolean {
  return preview.days.some(
    (day) => day.gitlog.length > 0 || day.gitCommit.length > 0,
  );
}

function splitDatesByToday(dates: string[]): { historical: string[]; recent: string[] } {
  const today = localTodayStr();
  return {
    historical: dates.filter((date) => date < today),
    recent: dates.filter((date) => date >= today),
  };
}

function mergeCachedHistoricalDays(
  request: CollectRequest,
  dates: string[],
  cached: FillPreview,
  fresh: FillPreview,
): FillPreview {
  const cachedByDate = new Map(cached.days.map((day) => [day.date, day]));
  const freshByDate = new Map(fresh.days.map((day) => [day.date, day]));
  const today = localTodayStr();
  return {
    ...fresh,
    scope: request.scope,
    anchorDate: request.anchorDate,
    rangeStart: request.rangeStart,
    rangeEnd: request.rangeEnd,
    dates,
    days: dates.map((date) => {
      if (date < today) {
        return (
          cachedByDate.get(date) ??
          freshByDate.get(date) ?? {
            date,
            completed: [],
            gitlog: [],
            gitCommit: [],
            originUrl: [],
            ailogDraft: [],
            warnings: [],
          }
        );
      }
      return (
        freshByDate.get(date) ?? {
          date,
          completed: [],
          gitlog: [],
          gitCommit: [],
          originUrl: [],
          ailogDraft: [],
          warnings: [],
        }
      );
    }),
  };
}

async function maybeAutoPolishAfterGit(
  deps: HostPanelDeps,
  request: CollectRequest,
  gitPreview: FillPreview,
  settings: Awaited<ReturnType<typeof loadPluginSettings>>,
): Promise<boolean> {
  if (!settings.autoPolishAfterCollect) {
    return false;
  }
  const apiKey = (await deps.context.secrets.get('dailyWorkLog.ai.apiKey')) || '';
  if (!apiKey) {
    return false;
  }
  await aiPolishFill(deps, request, { ...gitPreview, source: 'git' });
  return true;
}

async function loadLogsForDates(
  deps: HostPanelDeps,
  dates: string[],
): Promise<Record<string, DailyLog | null>> {
  const map: Record<string, DailyLog | null> = {};
  for (const date of dates) {
    map[date] = deps.workLogManager.getDailyLog(new Date(`${date}T12:00:00`));
  }
  return map;
}

function buildPreviewFromLogs(
  request: CollectRequest,
  existingLogs: Record<string, DailyLog | null>,
): FillPreview {
  const dates = resolveCollectDates(request);
  return {
    scope: request.scope,
    anchorDate: request.anchorDate,
    rangeStart: request.rangeStart,
    rangeEnd: request.rangeEnd,
    dates,
    source: 'ai',
    days: dates.map((date) => {
      const log = existingLogs[date];
      return {
        date,
        completed: log?.completed || [],
        gitlog: log?.gitlog || [],
        gitCommit: log?.gitCommit || [],
        originUrl: log?.origin_url || [],
        ailogDraft: log?.ailog || [],
        warnings: [],
      };
    }),
  };
}

async function resolveAiPolishPreview(
  deps: HostPanelDeps,
  request: CollectRequest,
  preview?: FillPreview,
): Promise<FillPreview | null> {
  if (preview) {
    return { ...preview, source: 'ai' };
  }

  const settings = await loadPluginSettings(deps);
  const monthKey = collectMonthKey(request);
  const cacheSearchConfig = buildFillCacheSearchConfig(settings);
  const cached = loadGitPreviewFromCache(
    deps,
    request,
    resolveCollectDates(request),
    settings,
  );
  if (cached && previewHasGitEvidence(cached)) {
    return { ...cached, source: 'ai' };
  }

  const existingLogs = await loadLogsForDates(deps, resolveCollectDates(request));
  const fromLogs = buildPreviewFromLogs(request, existingLogs);
  if (previewHasGitEvidence(fromLogs)) {
    return fromLogs;
  }

  return null;
}

export async function collectGitFill(
  deps: HostPanelDeps,
  request: CollectRequest,
): Promise<void> {
  const settings = await loadPluginSettings(deps);
  const dates = resolveCollectDates(request);
  const existingLogs = await loadLogsForDates(deps, dates);
  const monthKey = collectMonthKey(request);
  const runId = ++deps.state.collectRunId;
  const customRange = resolveCustomRange(request);
  const cacheSearchConfig = buildFillCacheSearchConfig(settings);

  const anchorLabel = formatFillAnchorLabel(request.scope, request.anchorDate, customRange);
  const targetDates = dates.join(', ');
  deps.postToWebview({
    command: 'collectLogStart',
    title: `Git 采集（${formatFillScopeAnchorTitle(request)}）`,
    scope: request.scope,
    dates,
    anchorDate: request.anchorDate,
  });

  const { historical, recent } = splitDatesByToday(dates);
  const tryPartialCache =
    settings.gitCollectCacheEnabled &&
    !request.forceRescan &&
    historical.length > 0 &&
    recent.length > 0;

  const cachedPreview = loadGitPreviewFromCache(deps, request, dates, settings);

  if (!request.forceRescan && cachedPreview && cacheCoversDates(cachedPreview, dates)) {
    postCollectLog(
      deps,
      `准备采集（命中采集缓存）| 范围 ${anchorLabel} | 共 ${dates.length} 天`,
      runId,
    );
    if (await maybeAutoPolishAfterGit(deps, request, cachedPreview, settings)) {
      return;
    }
    deps.postToWebview({
      command: 'collectLogEnd',
      preview: cachedPreview,
      fromCache: true,
    });
    return;
  }

  if (tryPartialCache) {
    const historicalPreview = loadGitPreviewFromCache(
      deps,
      request,
      historical,
      settings,
    );
    if (historicalPreview && cacheCoversDates(historicalPreview, historical)) {
      postCollectLog(
        deps,
        `混合采集：历史日读缓存，当日/未来日重新扫描 | 范围 ${anchorLabel}`,
        runId,
      );
      try {
        const fresh = await collectGitEvidence(
          deps,
          request,
          settings,
          existingLogs,
          runId,
        );
        if (runId !== deps.state.collectRunId) {
          return;
        }
        const merged = mergeCachedHistoricalDays(
          request,
          dates,
          historicalPreview,
          fresh,
        );
        deps.fillCacheService.save(
          monthKey,
          { ...merged, source: 'git' },
          cacheSearchConfig,
        );
        const gitPreview = { ...merged, source: 'git' as const };
        if (await maybeAutoPolishAfterGit(deps, request, gitPreview, settings)) {
          return;
        }
        deps.postToWebview({
          command: 'collectLogEnd',
          preview: gitPreview,
          fromCache: true,
        });
        return;
      } catch (error) {
        if (runId !== deps.state.collectRunId) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        deps.postToWebview({
          command: 'collectLogEnd',
          error: message,
          cancelled: message.includes('取消'),
        });
        return;
      }
    }
  }

  postCollectLog(
    deps,
    `准备采集（重新扫描 Git）| 范围 ${anchorLabel} | 写入目标日 ${targetDates} | 共 ${dates.length} 天`,
    runId,
  );

  try {
    const preview = await collectGitEvidence(
      deps,
      request,
      settings,
      existingLogs,
      runId,
    );
    if (runId !== deps.state.collectRunId) {
      return;
    }
    deps.fillCacheService.save(
      monthKey,
      { ...preview, source: 'git' },
      cacheSearchConfig,
    );
    const gitPreview = { ...preview, source: 'git' as const };
    if (await maybeAutoPolishAfterGit(deps, request, gitPreview, settings)) {
      return;
    }
    deps.postToWebview({
      command: 'collectLogEnd',
      preview: gitPreview,
      fromCache: false,
    });
  } catch (error) {
    if (runId !== deps.state.collectRunId) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    deps.postToWebview({
      command: 'collectLogEnd',
      error: message,
      cancelled: message.includes('取消'),
    });
  }
}

export async function aiPolishFill(
  deps: HostPanelDeps,
  request: CollectRequest,
  preview?: FillPreview,
): Promise<void> {
  const settings = await loadPluginSettings(deps);
  const apiKey = (await deps.context.secrets.get('dailyWorkLog.ai.apiKey')) || '';
  if (!apiKey) {
    vscode.window.showWarningMessage('请先在设置中配置 AI API Key');
    return;
  }

  const monthKey = collectMonthKey(request);
  const cacheSearchConfig = buildFillCacheSearchConfig(settings);
  const workingPreview = await resolveAiPolishPreview(deps, request, preview);
  if (!workingPreview) {
    vscode.window.showWarningMessage(
      '请先执行 Git 采集，或确保当前范围已有 GitLog / GitCommit 数据后再润色',
    );
    deps.postToWebview({
      command: 'collectLogEnd',
      error: '缺少 Git 采集数据，请先点击「Git 采集」',
    });
    return;
  }

  const runId = ++deps.state.collectRunId;
  deps.postToWebview({
    command: 'collectLogStart',
    title: `AI 润色（${formatFillScopeAnchorTitle(request)}）`,
    scope: request.scope,
    dates: workingPreview.dates,
    anchorDate: request.anchorDate,
  });

  try {
    postCollectLog(
      deps,
      preview
        ? '[AI] 基于当前确认页数据重新润色（不重复 Git 采集）'
        : '[AI] 基于已有 Git 采集数据润色 → 剔除发布版本类 commit → 生成今日完成',
      runId,
    );
    const existingLogs = await loadLogsForDates(deps, workingPreview.dates);
    const polishedDays = await deps.aiPolishService.polishDays(
      workingPreview.days,
      settings,
      apiKey,
      existingLogs,
      (line) => postCollectLog(deps, line, runId),
    );
    const nextPreview: FillPreview = {
      ...workingPreview,
      source: 'ai',
      days: polishedDays,
    };
    deps.fillCacheService.save(monthKey, nextPreview, cacheSearchConfig);
    deps.postToWebview({
      command: 'collectLogEnd',
      preview: nextPreview,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.postToWebview({
      command: 'collectLogEnd',
      error: message,
    });
  }
}

export async function applyFillPreview(
  deps: HostPanelDeps,
  preview: FillPreview,
  mode: 'git' | 'ai',
): Promise<void> {
  let applied = 0;
  const monthKey = preview.anchorDate.slice(0, 7);
  const daysToApply = preview.days.filter((day) => day.includeInApply !== false);

  if (mode === 'git') {
    const result = await applyGitPreview(
      {
        database: deps.database,
        workLogManager: deps.workLogManager,
        ensureStructuredEvidence: () =>
          deps.gitEvidenceService.ensureStructuredEvidence(
            requestForGitPreview(preview),
            deps.database,
            (line) => postCollectLog(deps, line),
          ),
        onLog: (line) => postCollectLog(deps, line),
      },
      preview,
    );
    applied = result.applied;
  } else {
    for (const day of daysToApply) {
      await savePolishedCompleted(
        deps.workLogManager,
        day.date,
        day.ailogDraft,
        day.originUrl || [],
        (line) => postCollectLog(deps, line),
      );
      day.appliedAi = true;
      applied += 1;
    }
  }

  const settings = await loadPluginSettings(deps);
  const cacheSearchConfig = buildFillCacheSearchConfig(settings);
  deps.fillCacheService.save(monthKey, preview, cacheSearchConfig);

  invalidateRepositoryOptionsCache();
  deps.postToWebview({
    command: 'fillApplied',
    message: `✅ 已写入 ${applied} 天（${mode === 'git' ? 'Git 字段' : '今日完成'}）`,
    mode,
    reloadDate: deps.state.activeDate ?? preview.anchorDate,
  });
  await deps.updateWebview();
}

export function discardFillPreview(_deps: HostPanelDeps): void {
  // no-op: preview discarded on webview side
}

/** Git 采集完成后自动 AI 润色（一键流水线） */
export async function collectAndPolish(
  deps: HostPanelDeps,
  request: CollectRequest,
): Promise<void> {
  const settings = await loadPluginSettings(deps);
  const dates = resolveCollectDates(request);
  const existingLogs = await loadLogsForDates(deps, dates);
  const monthKey = collectMonthKey(request);
  const runId = ++deps.state.collectRunId;
  const cacheSearchConfig = buildFillCacheSearchConfig(settings);

  deps.postToWebview({
    command: 'collectLogStart',
    title: `采集并润色（${formatFillScopeAnchorTitle(request)}）`,
    scope: request.scope,
    dates,
    anchorDate: request.anchorDate,
  });

  let gitPreview: FillPreview | null = loadGitPreviewFromCache(
    deps,
    request,
    dates,
    settings,
  );
  if (gitPreview) {
    postCollectLog(deps, '命中历史采集缓存', runId);
  }

  if (!gitPreview) {
    try {
      gitPreview = await collectGitEvidence(
        deps,
        request,
        settings,
        existingLogs,
        runId,
      );
      if (runId !== deps.state.collectRunId) {
        return;
      }
      deps.fillCacheService.save(
        monthKey,
        { ...gitPreview, source: 'git' },
        cacheSearchConfig,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.postToWebview({
        command: 'collectLogEnd',
        error: message,
        cancelled: message.includes('取消'),
      });
      return;
    }
  }

  await aiPolishFill(deps, request, { ...gitPreview, source: 'git' });
}
