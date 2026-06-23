import * as vscode from 'vscode';
import type { HostPanelDeps } from './types';
import { loadPluginSettings } from './settingsHandler';
import { expandHome } from './panelUtils';
import {
  aggregateRepoActivity,
  getRepoById,
  getRepoGroupByOrigin,
  listRepoGroups,
  loadRegistry,
  saveRegistry,
  updateRepoFlags,
} from '../../utils/repoRegistry';

async function resolveRepoRegistryRoot(deps: HostPanelDeps): Promise<string> {
  const settings = await loadPluginSettings(deps);
  const outputDir = settings.outputDir.trim();
  return outputDir ? expandHome(outputDir) : deps.workLogManager.getStorageDir();
}

export async function handleListRepos(
  deps: HostPanelDeps,
  search?: string,
): Promise<void> {
  const registryRoot = await resolveRepoRegistryRoot(deps);
  const registry = loadRegistry(registryRoot);
  const groups = listRepoGroups(registry, { search });
  deps.postToWebview({ command: 'reposListed', groups });
}

export async function handleGetRepoDetail(
  deps: HostPanelDeps,
  originUrl: string,
  cloneId?: string,
  month?: string,
): Promise<void> {
  const registryRoot = await resolveRepoRegistryRoot(deps);
  const registry = loadRegistry(registryRoot);
  const group = getRepoGroupByOrigin(registry, originUrl);
  if (!group) {
    deps.postToWebview({ command: 'repoDetail', error: '仓库不存在' });
    return;
  }
  const activity = aggregateRepoActivity(registryRoot, group, {
    cloneId,
    month,
    logStoragePaths: [deps.workLogManager.getStorageDir()],
  });
  deps.postToWebview({ command: 'repoDetail', group, activity, cloneId });
}

export async function handleOpenRepo(
  deps: HostPanelDeps,
  repoId: string,
): Promise<void> {
  const registryRoot = await resolveRepoRegistryRoot(deps);
  const registry = loadRegistry(registryRoot);
  const repo = getRepoById(registry, repoId);
  if (!repo) {
    vscode.window.showWarningMessage('仓库路径未找到');
    return;
  }
  const settings = await loadPluginSettings(deps);
  const uri = vscode.Uri.file(repo.repoRoot);
  try {
    if (settings.openRepoInNewWindow) {
      await vscode.commands.executeCommand('vscode.openFolder', uri, true);
    } else {
      await vscode.commands.executeCommand('vscode.openFolder', uri);
    }
    deps.postToWebview({ command: 'notify', message: `已打开 ${repo.repoRoot}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(`打开仓库失败: ${message}`);
    deps.postToWebview({ command: 'notify', message: `打开仓库失败: ${message}` });
  }
}

export async function handleUpdateRepo(
  deps: HostPanelDeps,
  repoId: string,
  flags: { pinned?: boolean; hidden?: boolean },
): Promise<void> {
  const registryRoot = await resolveRepoRegistryRoot(deps);
  let registry = loadRegistry(registryRoot);
  registry = updateRepoFlags(registry, repoId, flags);
  saveRegistry(registryRoot, registry);
  await handleListRepos(deps);
}
