import * as vscode from 'vscode';
import type { DailyLog } from '../utils/workLogManager';
import type { HostPanelDeps } from '../../app/types/hostDependencies';
import { getRepositoryOptions } from '../../shared/utils/panelUtils';
import { ProjectRepository } from '../../database/commands/projectRepository';
import { loadDailyLog, loadMonthlyLogs } from './loadDailyLog';
import { syncGeneratedJson } from './syncGeneratedJson';
import type { ProjectionGroup } from '../../database/commands/projectionRepository';

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

export function loadDailyProjection(
  deps: HostPanelDeps,
  date: string,
): { log: DailyLog; items: [] } {
  return {
    items: [],
    log: loadDailyLog(deps.workLogManager, date),
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
  _items?: unknown[],
): Promise<void> {
  try {
    await deps.workLogManager.saveUserFields(log.date, log);
    deps.postToWebview({
      command: 'saved',
      message: `✅ ${log.date} 日志已保存`,
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
    const monthlyLogs = loadMonthlyLogs(deps.workLogManager, year, month);
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

export async function handleSyncGeneratedJson(
  deps: HostPanelDeps,
  date: string,
  groups: ProjectionGroup[],
): Promise<void> {
  try {
    const result = await syncGeneratedJson(
      deps.database,
      deps.workLogManager,
      date,
      groups,
      (line) => deps.outputChannel.appendLine(line),
    );
    const skipped =
      result.skipped.length > 0
        ? `；${result.skipped.join('/')} 暂无结构化数据，已保留原 JSON`
        : '';
    deps.postToWebview({
      command: 'fillApplied',
      message: `✅ 已同步 ${result.projected.join('/') || '0'} 字段${skipped}`,
      reloadDate: date,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.outputChannel.appendLine(`[JSON] ${date} 手动同步失败：${message}`);
    deps.postToWebview({
      command: 'notify',
      message: `❌ JSON 同步失败：${message}`,
    });
  }
}
