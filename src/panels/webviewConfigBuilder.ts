import * as vscode from 'vscode';
import type { HostPanelDeps } from './handlers/types';
import { getRepositoryOptions } from './handlers/panelUtils';
import { loadPluginSettings } from './handlers/settingsHandler';

export async function buildWebConfig(deps: HostPanelDeps) {
  const settings = await loadPluginSettings(deps);
  const optional = new Set(settings.visibleFields);
  const vsConfig = vscode.workspace.getConfiguration('dailyWorkLog');
  const hasPassword = Boolean(
    await deps.context.secrets.get('dailyWorkLog.email.password'),
  );
  return {
    storagePath: vsConfig.get<string>('storagePath') || '~/.work-logs',
    autoSave: vsConfig.get<boolean>('autoSave') ?? true,
    timesheetFullDateEnabled: settings.timesheetFullDateEnabled,
    aiEnabled: settings.aiEnabled,
    dailySyncFieldVisibility: settings.dailySyncFieldVisibility,
    showCompletedInput: true,
    showAilogInput: true,
    showOriginUrlInput: true,
    showPlanInput: optional.has('plan'),
    showBlockersInput: optional.has('blockers'),
    showNotesInput: optional.has('notes'),
    showGitlogInput: optional.has('gitlog'),
    showGitCommitInput: optional.has('gitCommit'),
    timesheetContentField: settings.timesheetContentField,
    email: {
      ...settings.email,
      hasPassword,
    },
  };
}

export async function sendFullConfig(deps: HostPanelDeps): Promise<void> {
  const config = await buildWebConfig(deps);
  deps.postToWebview({
    command: 'fullConfigUpdate',
    config,
  });
}

export async function updateWebview(deps: HostPanelDeps): Promise<void> {
  if (!deps.view) {
    return;
  }
  const todayLog = deps.workLogManager.getTodayLog();
  const activeDate = deps.state.activeDate ?? todayLog.date;
  const displayLog =
    deps.workLogManager.getDailyLog(new Date(`${activeDate}T12:00:00`)) ?? {
      ...todayLog,
      date: activeDate,
    };
  const config = await buildWebConfig(deps);
  deps.view.webview.postMessage({
    command: 'init',
    todayLog: displayLog,
    activeDate,
    repositoryOptions: getRepositoryOptions(activeDate.slice(0, 7)),
    config,
  });
}
