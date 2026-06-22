import * as vscode from 'vscode';
import * as path from 'path';
import type { DailyLog } from '../../lib/workLogManager';
import type { HostPanelDeps } from './types';
import { expandHome, getRepositoryOptions, resolveStoragePath } from './panelUtils';
import { loadPluginSettings } from './settingsHandler';

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

export async function handleSave(deps: HostPanelDeps, log: DailyLog): Promise<void> {
  try {
    const logDate = new Date(log.date + 'T12:00:00');
    deps.workLogManager.saveDailyLog(logDate, log);
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
    const logDate = new Date(date + 'T12:00:00');
    const log = deps.workLogManager.getDailyLog(logDate);
    deps.postToWebview({
      command: 'dateLoaded',
      log: log || emptyLog(date),
      repositoryOptions: getRepositoryOptions(date.slice(0, 7)),
    });
  } catch (e) {
    deps.postToWebview({
      command: 'dateLoaded',
      log: emptyLog(date),
      repositoryOptions: getRepositoryOptions(date.slice(0, 7)),
    });
  }
}

export async function handleLoadMonthLogs(
  deps: HostPanelDeps,
  year: number,
  month: number,
): Promise<void> {
  try {
    const monthlyLogs = deps.workLogManager.getMonthlyLogs(year, month);
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const storagePath = resolveStoragePath();
    const settings = await loadPluginSettings(deps);
    const outputDir = settings.outputDir.trim()
      ? expandHome(settings.outputDir)
      : storagePath;
    const monthDir = path.join(outputDir, monthKey);
    monthlyLogs.logs = deps.gitEvidenceService.enrichLogsFromCommits(
      monthDir,
      monthlyLogs.logs,
    );
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
