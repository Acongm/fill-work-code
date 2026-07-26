import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { HostPanelDeps } from './types';
import { resolveRuntimePaths } from '../../settings/utils/pathUtils';

export { expandHome } from '../../settings/utils/pathUtils';

export function resolveStoragePath(): string {
  const config = vscode.workspace.getConfiguration('dailyWorkLog');
  const storagePath = config.get<string>('storagePath') || '~/.work-logs';
  return resolveRuntimePaths(storagePath).root;
}

export function getRepositoryOptions(yearMonth: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return [];
  }

  const storagePath = resolveStoragePath();
  const monthDir = path.join(storagePath, yearMonth);
  const candidates = [
    path.join(monthDir, 'gitlog', '产物清单.tsv'),
    path.join(monthDir, '_artifacts.tsv'),
  ];
  const urls = new Set<string>();

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    try {
      const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const cols = line.split('\t');
        const originUrl = cols[2];
        if (originUrl && originUrl !== 'origin_url') {
          urls.add(originUrl);
        }
      }
    } catch (e) {
      console.warn(`读取仓库清单失败: ${filePath}`, e);
    }
  }

  return [...urls].sort();
}

export async function getDisplayName(deps: HostPanelDeps): Promise<string> {
  const fromState = deps.context.globalState.get<string>('pluginSettings.displayName');
  if (fromState?.trim()) {
    return fromState.trim();
  }
  const fromConfig = vscode.workspace
    .getConfiguration('dailyWorkLog')
    .get<string>('displayName');
  return fromConfig?.trim() || 'User';
}

export function isPreviewEnabled(): boolean {
  const config = vscode.workspace.getConfiguration('dailyWorkLog');
  return config.get<boolean>('preview.enabled') ?? true;
}
