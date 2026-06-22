import * as vscode from 'vscode';
import {
  DEFAULT_PLUGIN_SETTINGS,
  type PluginSettings,
} from '../../features/settings/pluginSettings';
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  normalizeAiSystemPromptForSave,
} from '../../features/settings/aiSystemPrompt';
import { resolveOriginFilters } from '../../utils/originFilter';
import { secretDisplayInfo } from '../../lib/secretMask';
import type { HostPanelDeps } from './types';
import { expandHome, getDisplayName } from './panelUtils';

export async function loadPluginSettings(deps: HostPanelDeps): Promise<PluginSettings> {
  const stored = deps.context.globalState.get<PluginSettings>('pluginSettings');
  const config = vscode.workspace.getConfiguration('dailyWorkLog');
  const merged: PluginSettings = {
    ...DEFAULT_PLUGIN_SETTINGS,
    ...stored,
    aiThinkingEnabled: stored?.aiThinkingEnabled ?? DEFAULT_PLUGIN_SETTINGS.aiThinkingEnabled,
    aiReasoningEffort: stored?.aiReasoningEffort ?? DEFAULT_PLUGIN_SETTINGS.aiReasoningEffort,
    aiTemperature: stored?.aiTemperature ?? DEFAULT_PLUGIN_SETTINGS.aiTemperature,
    aiTimeoutMs: stored?.aiTimeoutMs ?? DEFAULT_PLUGIN_SETTINGS.aiTimeoutMs,
    aiSystemPrompt: stored?.aiSystemPrompt ?? DEFAULT_PLUGIN_SETTINGS.aiSystemPrompt,
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
    merged.displayName = (await getDisplayName(deps)) || 'User';
  }
  merged.timesheet = {
    ...DEFAULT_PLUGIN_SETTINGS.timesheet,
    ...stored?.timesheet,
  };
  return merged;
}

export async function savePluginSettings(
  deps: HostPanelDeps,
  settings: PluginSettings,
  apiKey?: string,
  emailPassword?: string,
): Promise<void> {
  const normalized: PluginSettings = {
    ...settings,
    aiSystemPrompt: normalizeAiSystemPromptForSave(settings.aiSystemPrompt),
  };
  await deps.context.globalState.update('pluginSettings', normalized);
  if (apiKey?.trim()) {
    await deps.context.secrets.store('dailyWorkLog.ai.apiKey', apiKey.trim());
  }
  if (emailPassword?.trim()) {
    await deps.context.secrets.store(
      'dailyWorkLog.email.password',
      emailPassword.trim(),
    );
  }
  deps.postToWebview({ command: 'pluginSettingsSaved' });
  await deps.updateWebview();
}

export async function sendPluginSettings(deps: HostPanelDeps): Promise<void> {
  const settings = await loadPluginSettings(deps);
  const apiKeyRaw = (await deps.context.secrets.get('dailyWorkLog.ai.apiKey')) || '';
  const emailPasswordRaw =
    (await deps.context.secrets.get('dailyWorkLog.email.password')) || '';
  const config = vscode.workspace.getConfiguration('dailyWorkLog');
  const storagePath = config.get<string>('storagePath') || '~/.work-logs';
  deps.postToWebview({
    command: 'pluginSettingsLoaded',
    settings,
    aiSystemPromptDefault: DEFAULT_AI_SYSTEM_PROMPT,
    secrets: {
      apiKey: secretDisplayInfo(apiKeyRaw),
      emailPassword: secretDisplayInfo(emailPasswordRaw),
    },
    vscodeConfig: {
      storagePath,
      storagePathResolved: expandHome(storagePath),
      autoSave: config.get<boolean>('autoSave') ?? true,
      previewEnabled: config.get<boolean>('preview.enabled') ?? true,
    },
  });
}

export async function revealPluginSecret(
  deps: HostPanelDeps,
  field: 'apiKey' | 'emailPassword',
): Promise<void> {
  const key =
    field === 'apiKey'
      ? 'dailyWorkLog.ai.apiKey'
      : 'dailyWorkLog.email.password';
  const value = (await deps.context.secrets.get(key)) || '';
  deps.postToWebview({
    command: 'secretRevealed',
    field,
    value,
  });
  if (value) {
    deps.outputChannel.appendLine(
      `${field === 'apiKey' ? 'API Key' : '邮件密码'}: ${value}`,
    );
  }
}
