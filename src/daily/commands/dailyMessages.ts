import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { DailyLog } from '../utils/workLogManager';
import type { HostPanelDeps } from '../../app/types/hostDependencies';
import { getRepositoryOptions, resolveStoragePath } from '../../shared/utils/panelUtils';
import { saveDailyItems } from './saveDailyItems';
import { loadDailyItems } from './loadDailyItems';
import type { DailyItemInput } from '../../database/commands/dailyItemRepository';
import { ProjectRepository } from '../../database/commands/projectRepository';

const emptyLog = (date: string): DailyLog => ({
  date,
  completed: [],
  plan: [],
  blockers: [],
  notes: '',
  gitlog: [],
  ailog: [],
  gitCommit: [],
  origin_url: [],
});

function itemId(date: string, kind: string, index: number, content: string): string {
  return `manual:${crypto
    .createHash('sha256')
    .update(`${date}:${kind}:${index}:${content}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function legacyLogItems(log: DailyLog): DailyItemInput[] {
  const rows = [
    ...log.completed.map((content) => ({ kind: 'completed' as const, content })),
    ...(log.ailog || []).map((content) => ({ kind: 'ailog' as const, content })),
    ...log.plan.map((content) => ({ kind: 'todo' as const, content })),
    ...log.blockers.map((content) => ({ kind: 'blocker' as const, content })),
    ...(log.notes.trim()
      ? [{ kind: 'note' as const, content: log.notes.trim() }]
      : []),
  ];
  return rows.map((row, index) => ({
    id: itemId(log.date, row.kind, index, row.content),
    date: log.date,
    kind: row.kind,
    content: row.content,
    assignment: 'unassigned',
    projectId: null,
    source: 'manual',
    sortOrder: index,
  }));
}

export function loadDailyProjection(
  deps: HostPanelDeps,
  date: string,
): { log: DailyLog; items: ReturnType<typeof loadDailyItems> } {
  const items = loadDailyItems(deps.database, date);
  const byKind = (kind: DailyItemInput['kind']) =>
    items.filter((item) => item.kind === kind).map((item) => item.content);
  const gitlog = deps.database
    .all<{ content: string }>(
      'SELECT content FROM gitlog_entries WHERE date = ? ORDER BY id',
      [date],
    )
    .map((row) => row.content);
  const commits = deps.database
    .all<{ subject: string }>(
      `SELECT subject FROM commits
       WHERE substr(committed_at, 1, 10) = ?
       ORDER BY committed_at, id`,
      [date],
    )
    .map((row) => row.subject);
  const origins = deps.database
    .all<{ origin_url: string }>(
      `SELECT DISTINCT p.origin_url FROM projects p
       WHERE p.id IN (
         SELECT project_id FROM daily_items
           WHERE date = ? AND project_id IS NOT NULL
         UNION SELECT project_id FROM gitlog_entries WHERE date = ?
         UNION SELECT project_id FROM commits
           WHERE substr(committed_at, 1, 10) = ?
       ) ORDER BY p.origin_url`,
      [date, date, date],
    )
    .map((row) => row.origin_url);
  return {
    items,
    log: {
      date,
      completed: byKind('completed'),
      plan: byKind('todo'),
      blockers: byKind('blocker'),
      notes: byKind('note').join('\n'),
      gitlog,
      ailog: byKind('ailog'),
      gitCommit: commits,
      origin_url: origins,
    },
  };
}

function repositoryOptions(deps: HostPanelDeps): string[] {
  return new ProjectRepository(deps.database)
    .list('', false)
    .map((project) => project.originUrl);
}

export async function handleSave(
  deps: HostPanelDeps,
  log: DailyLog,
  items?: DailyItemInput[],
): Promise<void> {
  try {
    const saveItems = items ? items : legacyLogItems(log);
    const result = await saveDailyItems(deps.database, resolveStoragePath(), {
      date: log.date,
      items: saveItems.map(({ date: _date, ...item }) => item),
    });
    deps.postToWebview({
      command: 'saved',
      message:
        result.warnings.length > 0
          ? `✅ 已保存，兼容文件有 ${result.warnings.length} 个警告`
          : `✅ ${log.date} 日志已保存`,
    });
  } catch (e) {
    vscode.window.showErrorMessage(`保存失败: ${e}`);
  }
}

export async function handleLoadDate(deps: HostPanelDeps, date: string): Promise<void> {
  deps.state.activeDate = date;
  try {
    const projection = loadDailyProjection(deps, date);
    deps.postToWebview({
      command: 'dateLoaded',
      log: projection.log,
      items: projection.items,
      repositoryOptions: repositoryOptions(deps),
    });
  } catch (e) {
    deps.postToWebview({
      command: 'dateLoaded',
      log: emptyLog(date),
      items: [],
      repositoryOptions: repositoryOptions(deps),
    });
  }
}

export async function handleLoadMonthLogs(
  deps: HostPanelDeps,
  year: number,
  month: number,
): Promise<void> {
  try {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const dates = deps.database
      .all<{ date: string }>(
        `SELECT date FROM daily_items WHERE substr(date, 1, 7) = ?
         UNION SELECT date FROM gitlog_entries WHERE substr(date, 1, 7) = ?
         UNION SELECT substr(committed_at, 1, 10) AS date FROM commits
           WHERE substr(committed_at, 1, 7) = ?
         ORDER BY date`,
        [monthKey, monthKey, monthKey],
      )
      .map((row) => row.date);
    const monthlyLogs = {
      year,
      month,
      logs: dates.map((date) => loadDailyProjection(deps, date).log),
    };
    deps.postToWebview({
      command: 'monthLogsLoaded',
      data: monthlyLogs,
    });
  } catch (e) {
    vscode.window.showErrorMessage(`加载月度日志失败: ${e}`);
  }
}

export function handleLoadRepositoryOptions(
  deps: HostPanelDeps,
  month?: string,
  date?: string,
): void {
  deps.postToWebview({
    command: 'repositoryOptionsLoaded',
    options: getRepositoryOptions(month || date?.slice(0, 7) || ''),
  });
}

export function handleClearSummaryCache(
  deps: HostPanelDeps,
  year: number,
  month: number,
): void {
  deps.workLogManager.clearMonthSummaryCache(year, month);
}
