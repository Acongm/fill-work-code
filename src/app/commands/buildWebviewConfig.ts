import * as vscode from 'vscode';
import type { HostPanelDeps } from '../types/hostDependencies';
import { loadPluginSettings } from '../../settings/commands/settingsMessages';
import { loadRuntimeConfiguration } from '../../settings/commands/settingsStore';
import {
  loadDailyProjection,
  repositoryOptionsForDate,
} from '../../daily/commands/dailyMessages';
import { listRepositoryOptions } from '../../shared/utils/listRepositoryOptions';

export async function buildWebConfig(deps: HostPanelDeps) {
  const settings = await loadPluginSettings(deps);
  const optional = new Set(settings.visibleFields);
  const runtimeConfig = loadRuntimeConfiguration();
  const hasPassword = Boolean(
    await deps.context.secrets.get('dailyWorkLog.email.password'),
  );
  return {
    storagePath: runtimeConfig.storagePath,
    autoSave: runtimeConfig.autoSave,
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

export async function refreshActiveDate(
  deps: HostPanelDeps,
  date?: string,
): Promise<void> {
  if (!deps.view) {
    return;
  }
  const started = Date.now();
  const activeDate =
    date ?? deps.state.activeDate ?? new Date().toLocaleDateString('en-CA');
  deps.state.activeDate = activeDate;
  const projection = loadDailyProjection(deps, activeDate);
  deps.view.webview.postMessage({
    command: 'dateLoaded',
    log: projection.log,
    items: projection.items,
    repositoryOptions: repositoryOptionsForDate(deps, activeDate),
  });
  deps.outputChannel.appendLine(
    `[perf] refreshActiveDate ${activeDate} ${Date.now() - started}ms`,
  );
}

export async function updateWebview(deps: HostPanelDeps): Promise<void> {
  if (!deps.view) {
    return;
  }
  const started = Date.now();
  const activeDate =
    deps.state.activeDate ?? new Date().toLocaleDateString('en-CA');
  const projection = loadDailyProjection(deps, activeDate);
  const config = await buildWebConfig(deps);
  deps.view.webview.postMessage({
    command: 'init',
    todayLog: projection.log,
    items: projection.items,
    activeDate,
    repositoryOptions: listRepositoryOptions(deps.database),
    config,
  });
  deps.outputChannel.appendLine(
    `[perf] init ${activeDate} ${Date.now() - started}ms`,
  );
}
