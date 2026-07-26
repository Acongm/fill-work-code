import type { PluginSettings } from '../types/pluginSettings';
import { DEFAULT_AI_SYSTEM_PROMPT } from '../utils/aiSystemPrompt';
import { secretDisplayInfo } from '../utils/secretMask';
import type { HostPanelDeps } from '../../app/types/hostDependencies';
import {
  loadRuntimeConfiguration,
  loadStoredPluginSettings,
  saveStoredPluginSettings,
} from './settingsStore';

export async function loadPluginSettings(deps: HostPanelDeps): Promise<PluginSettings> {
  return loadStoredPluginSettings(deps.context);
}

export async function savePluginSettings(
  deps: HostPanelDeps,
  settings: PluginSettings,
  apiKey?: string,
  emailPassword?: string,
): Promise<void> {
  await saveStoredPluginSettings(deps.context, settings, {
    apiKey,
    emailPassword,
  });
  deps.postToWebview({ command: 'pluginSettingsSaved' });
  await deps.updateWebview();
}

export async function sendPluginSettings(deps: HostPanelDeps): Promise<void> {
  const settings = await loadPluginSettings(deps);
  const apiKeyRaw = (await deps.context.secrets.get('dailyWorkLog.ai.apiKey')) || '';
  const emailPasswordRaw =
    (await deps.context.secrets.get('dailyWorkLog.email.password')) || '';
  deps.postToWebview({
    command: 'pluginSettingsLoaded',
    settings,
    aiSystemPromptDefault: DEFAULT_AI_SYSTEM_PROMPT,
    secrets: {
      apiKey: secretDisplayInfo(apiKeyRaw),
      emailPassword: secretDisplayInfo(emailPasswordRaw),
    },
    vscodeConfig: loadRuntimeConfiguration(),
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
