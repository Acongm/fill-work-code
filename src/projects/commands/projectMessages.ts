import * as vscode from 'vscode';
import type { HostPanelDeps } from '../../app/types/hostDependencies';
import { loadPluginSettings } from '../../settings/commands/settingsMessages';
import { ProjectRepository } from '../../database/commands/projectRepository';
import { mergeJsonProjectHistory } from './mergeJsonProjectHistory';

function toLegacyGroup(
  project: ReturnType<ProjectRepository['list']>[number],
  clones: ReturnType<ProjectRepository['listClones']>,
) {
  return {
    projectId: project.id,
    originUrl: project.originUrl,
    repoName: project.name,
    cloneCount: clones.length,
    lastCommitAt: clones
      .map((clone) => clone.lastCommitAt || '')
      .sort()
      .at(-1),
    clones: clones.map((clone) => ({
      id: clone.id,
      repoRoot: clone.repoRoot,
      repoName: project.name,
      originUrl: project.originUrl,
      cloneLabel: clone.cloneLabel,
      firstSeenAt: clone.firstSeenAt,
      lastScannedAt: clone.lastScannedAt || '',
      lastCommitAt: clone.lastCommitAt || undefined,
      commitCountTotal: 0,
      pinned: project.pinned,
      hidden: project.hidden,
      scanMissCount: 0,
    })),
  };
}

export async function handleListRepos(
  deps: HostPanelDeps,
  search?: string,
): Promise<void> {
  const repository = new ProjectRepository(deps.database);
  const groups = repository
    .list(search || '', false)
    .map((project) =>
      toLegacyGroup(project, repository.listClones(project.id)),
    );
  deps.postToWebview({ command: 'reposListed', groups });
}

export async function handleGetRepoDetail(
  deps: HostPanelDeps,
  originUrl: string,
  cloneId?: string,
  _month?: string,
): Promise<void> {
  const repository = new ProjectRepository(deps.database);
  const project = repository.getByOrigin(originUrl);
  if (!project) {
    deps.postToWebview({ command: 'repoDetail', error: '项目不存在' });
    return;
  }
  const clones = repository.listClones(project.id);
  const structuredHistory = await repository.getHistory(project.id, {
    cloneId,
  });
  const history = mergeJsonProjectHistory(
    structuredHistory,
    deps.workLogManager.getAllDailyLogs(),
    project.originUrl,
  );
  deps.postToWebview({
    command: 'repoDetail',
    group: toLegacyGroup(project, clones),
    history,
    cloneId,
  });
}

export async function handleOpenRepo(
  deps: HostPanelDeps,
  repoId: string,
): Promise<void> {
  const clone = deps.database.get<{ repo_root: string }>(
    'SELECT repo_root FROM project_clones WHERE id = ?',
    [repoId],
  );
  if (!clone) {
    vscode.window.showWarningMessage('仓库路径未找到');
    return;
  }
  const settings = await loadPluginSettings(deps);
  const uri = vscode.Uri.file(clone.repo_root);
  try {
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      uri,
      settings.openRepoInNewWindow || undefined,
    );
    deps.postToWebview({
      command: 'notify',
      message: `已打开 ${clone.repo_root}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(`打开仓库失败: ${message}`);
  }
}

export async function handleUpdateRepo(
  deps: HostPanelDeps,
  repoId: string,
  flags: { pinned?: boolean; hidden?: boolean },
): Promise<void> {
  const row = deps.database.get<{ project_id: string }>(
    'SELECT project_id FROM project_clones WHERE id = ?',
    [repoId],
  );
  if (!row) {
    return;
  }
  await new ProjectRepository(deps.database).updateFlags(row.project_id, flags);
  await handleListRepos(deps);
}
