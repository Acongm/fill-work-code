import * as vscode from 'vscode';
import {
  DEFAULT_PLUGIN_SETTINGS,
  type PluginSettings,
} from '../../features/settings/pluginSettings';
import { normalizeAiSystemPromptForSave } from '../../features/settings/aiSystemPrompt';
import { resolveOriginFilters } from '../../utils/originFilter';
import type {
  PluginSecretUpdates,
  RuntimeConfiguration,
} from '../types/settings';
import { resolveRuntimePaths } from '../utils/pathUtils';

const SETTINGS_KEY = 'pluginSettings';
const LEGACY_OUTPUT_DIRECTORY_KEY = ['output', 'Dir'].join('');

export function loadRuntimeConfiguration(): RuntimeConfiguration {
  const config = vscode.workspace.getConfiguration('dailyWorkLog');
  const storagePath = config.get<string>('storagePath') || '~/.work-logs';
  return {
    storagePath,
    storagePathResolved: resolveRuntimePaths(storagePath).root,
    autoSave: config.get<boolean>('autoSave') ?? true,
    previewEnabled: config.get<boolean>('preview.enabled') ?? true,
  };
}

export async function loadStoredPluginSettings(
  context: vscode.ExtensionContext,
): Promise<PluginSettings> {
  const stored = context.globalState.get<PluginSettings>(SETTINGS_KEY);
  const config = vscode.workspace.getConfiguration('dailyWorkLog');
  const cleanStored = { ...(stored || {}) } as Partial<PluginSettings> &
    Record<string, unknown>;
  delete cleanStored[LEGACY_OUTPUT_DIRECTORY_KEY];

  const merged: PluginSettings = {
    ...DEFAULT_PLUGIN_SETTINGS,
    ...cleanStored,
    aiThinkingEnabled:
      stored?.aiThinkingEnabled ?? DEFAULT_PLUGIN_SETTINGS.aiThinkingEnabled,
    aiReasoningEffort:
      stored?.aiReasoningEffort ?? DEFAULT_PLUGIN_SETTINGS.aiReasoningEffort,
    aiTemperature:
      stored?.aiTemperature ?? DEFAULT_PLUGIN_SETTINGS.aiTemperature,
    aiTimeoutMs: stored?.aiTimeoutMs ?? DEFAULT_PLUGIN_SETTINGS.aiTimeoutMs,
    aiSystemPrompt:
      stored?.aiSystemPrompt ?? DEFAULT_PLUGIN_SETTINGS.aiSystemPrompt,
    aiShowReasoningStream:
      stored?.aiShowReasoningStream ??
      DEFAULT_PLUGIN_SETTINGS.aiShowReasoningStream,
    dailySyncFieldVisibility:
      stored?.dailySyncFieldVisibility ??
      DEFAULT_PLUGIN_SETTINGS.dailySyncFieldVisibility,
    gitCollectCacheEnabled:
      stored?.gitCollectCacheEnabled ??
      DEFAULT_PLUGIN_SETTINGS.gitCollectCacheEnabled,
    originFilters: resolveOriginFilters({
      originFilters: stored?.originFilters,
      originHosts: stored?.originHosts,
    }),
    timesheet: {
      ...DEFAULT_PLUGIN_SETTINGS.timesheet,
      ...stored?.timesheet,
    },
    email: {
      ...DEFAULT_PLUGIN_SETTINGS.email,
      ...stored?.email,
      smtpHost:
        stored?.email?.smtpHost || config.get<string>('email.smtpHost') || '',
      smtpPort:
        stored?.email?.smtpPort || config.get<number>('email.smtpPort') || 587,
      username:
        stored?.email?.username || config.get<string>('email.username') || '',
      from: stored?.email?.from || config.get<string>('email.from') || '',
      to: stored?.email?.to || config.get<string>('email.to') || '',
      cc: stored?.email?.cc || config.get<string>('email.cc') || '',
    },
  };

  if (!merged.displayName) {
    merged.displayName =
      context.globalState.get<string>('pluginSettings.displayName')?.trim() ||
      config.get<string>('displayName')?.trim() ||
      'User';
  }

  return merged;
}

export async function saveStoredPluginSettings(
  context: vscode.ExtensionContext,
  settings: PluginSettings,
  secrets: PluginSecretUpdates = {},
): Promise<void> {
  const normalized: PluginSettings = {
    ...settings,
    aiSystemPrompt: normalizeAiSystemPromptForSave(settings.aiSystemPrompt),
  };
  await context.globalState.update(SETTINGS_KEY, normalized);

  if (secrets.apiKey?.trim()) {
    await context.secrets.store(
      'dailyWorkLog.ai.apiKey',
      secrets.apiKey.trim(),
    );
  }
  if (secrets.emailPassword?.trim()) {
    await context.secrets.store(
      'dailyWorkLog.email.password',
      secrets.emailPassword.trim(),
    );
  }
}
