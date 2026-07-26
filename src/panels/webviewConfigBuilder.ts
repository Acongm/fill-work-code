import * as vscode from 'vscode';
import type { HostPanelDeps } from './handlers/types';
import { loadPluginSettings } from './handlers/settingsHandler';
import { loadRuntimeConfiguration } from '../settings/commands/settingsStore';
import { loadDailyProjection } from './handlers/dailyLogHandler';
import { ProjectRepository } from '../database/commands/projectRepository';

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

export async function updateWebview(deps: HostPanelDeps): Promise<void> {
  if (!deps.view) {
    return;
  }
  const activeDate =
    deps.state.activeDate ?? new Date().toLocaleDateString('en-CA');
  const projection = loadDailyProjection(deps, activeDate);
  const config = await buildWebConfig(deps);
  deps.view.webview.postMessage({
    command: 'init',
    todayLog: projection.log,
    items: projection.items,
    activeDate,
    repositoryOptions: new ProjectRepository(deps.database)
      .list('', false)
      .map((project) => project.originUrl),
    config,
  });
}
