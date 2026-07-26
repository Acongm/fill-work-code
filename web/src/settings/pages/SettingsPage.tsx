import * as React from 'react';
import { OverlayHeader } from '../../shared/views/OverlayHeader';
import { SecretField, type SecretMeta } from '../../shared/views/SecretField';
import { SettingsFieldGroup } from '../views/SettingField';

export interface PluginSettingsForm {
  displayName: string;
  searchRoots: string;
  originFilters: string;
  authorAliases: string;
  aiEnabled: boolean;
  aiPreset: 'deepseek' | 'mimo' | 'custom';
  aiModel: string;
  aiBaseUrl: string;
  aiThinkingEnabled: boolean;
  aiReasoningEffort: 'high' | 'max';
  aiTemperature: number;
  aiTimeoutMs: number;
  /** 当前编辑中的 system prompt（展示用，空则等同默认） */
  aiSystemPrompt: string;
  /** 内置默认 prompt，用于「重置」 */
  aiSystemPromptDefault: string;
  aiShowReasoningStream: boolean;
  timesheetContentField: string;
  visibleFields: string[];
  dailySyncFieldVisibility: boolean;
  gitCollectCacheEnabled: boolean;
  autoPolishAfterCollect?: boolean;
  weekendRollforward?: boolean;
  openRepoInNewWindow?: boolean;
  timesheet?: {
    company: string;
    approver: string;
    defaultHours: number;
  };
  email: {
    smtpHost: string;
    smtpPort: number;
    username: string;
    from: string;
    to: string;
    cc: string;
  };
}

export interface VscodeConfigDisplay {
  storagePath: string;
  storagePathResolved: string;
  autoSave: boolean;
  previewEnabled: boolean;
}

interface SettingsOverlayProps {
  settings: PluginSettingsForm;
  secrets: { apiKey: SecretMeta; emailPassword: SecretMeta };
  vscodeConfig?: VscodeConfigDisplay;
  onChange: (settings: PluginSettingsForm) => void;
  onSave: (apiKey: string, emailPassword: string) => void;
  onClose: () => void;
  apiKeyEdit: string;
  emailPasswordEdit: string;
  onApiKeyEdit: (v: string) => void;
  onEmailPasswordEdit: (v: string) => void;
  revealed: Record<string, string | null>;
  onReveal: (field: 'apiKey' | 'emailPassword') => void;
  onHide: (field: 'apiKey' | 'emailPassword') => void;
}

export const SettingsOverlay: React.FC<SettingsOverlayProps> = ({
  settings,
  secrets,
  vscodeConfig,
  onChange,
  onSave,
  onClose,
  apiKeyEdit,
  onApiKeyEdit,
  revealed,
  onReveal,
  onHide,
}) => (
  <section className="page-overlay settings-overlay-page">
    <OverlayHeader title="系统设置" onBack={onClose} />
    <div className="overlay-body settings-overlay-body">
      {vscodeConfig && (
        <section className="settings-section">
          <h3>VS Code 配置（只读）</h3>
          <dl className="settings-readonly">
            <dt>存储路径</dt>
            <dd>{vscodeConfig.storagePathResolved}</dd>
            <dt>自动保存</dt>
            <dd>{vscodeConfig.autoSave ? '是' : '否'}</dd>
            <dt>Markdown 预览</dt>
            <dd>{vscodeConfig.previewEnabled ? '启用' : '关闭'}</dd>
          </dl>
        </section>
      )}
      <section className="settings-section">
        <h3>Git 采集</h3>
        <SettingsFieldGroup section="git" settings={settings} onChange={onChange} />
        <p className="setting-hint">
          Origin 过滤：主机名精确匹配 host；含 <code>@</code>、<code>/</code>、<code>:</code> 的条目按
          remote URL 子串匹配。
        </p>
      </section>
      <section className="settings-section">
        <h3>AI（OpenAI 兼容）</h3>
        <div className="setting-row">
          <label>
            <input
              type="checkbox"
              checked={settings.aiEnabled}
              onChange={(e) => onChange({ ...settings, aiEnabled: e.target.checked })}
            />{' '}
            启用 AI 润色
          </label>
        </div>
        <div className="setting-row">
          <label>预设</label>
          <select
            value={settings.aiPreset}
            onChange={(e) =>
              onChange({
                ...settings,
                aiPreset: e.target.value as PluginSettingsForm['aiPreset'],
              })
            }
          >
            <option value="deepseek">DeepSeek</option>
            <option value="mimo">小米 MiMo</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div className="setting-row">
          <label>Base URL</label>
          <input
            value={settings.aiBaseUrl}
            onChange={(e) => onChange({ ...settings, aiBaseUrl: e.target.value })}
          />
        </div>
        <div className="setting-row">
          <label>Model</label>
          <input
            value={settings.aiModel}
            onChange={(e) => onChange({ ...settings, aiModel: e.target.value })}
            placeholder="如 deepseek-v4-pro（在系统设置中填写）"
          />
        </div>
        <div className="setting-row">
          <label>
            <input
              type="checkbox"
              checked={settings.aiThinkingEnabled}
              onChange={(e) =>
                onChange({ ...settings, aiThinkingEnabled: e.target.checked })
              }
            />{' '}
            启用 Thinking（DeepSeek V4 推理模式，更慢但更准）
          </label>
        </div>
        {settings.aiThinkingEnabled && (
          <div className="setting-row">
            <label>推理强度 reasoning_effort</label>
            <select
              value={settings.aiReasoningEffort}
              onChange={(e) =>
                onChange({
                  ...settings,
                  aiReasoningEffort: e.target.value as 'high' | 'max',
                })
              }
            >
              <option value="high">high（默认）</option>
              <option value="max">max（更深，更慢）</option>
            </select>
          </div>
        )}
        <div className="setting-row">
          <label>
            温度 temperature
            {settings.aiThinkingEnabled ? '（Thinking 开启时 API 通常忽略）' : ''}
          </label>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            disabled={settings.aiThinkingEnabled}
            value={settings.aiTemperature}
            onChange={(e) =>
              onChange({
                ...settings,
                aiTemperature: Number(e.target.value) || 0.2,
              })
            }
          />
        </div>
        <div className="setting-row">
          <label>请求超时（秒）</label>
          <input
            type="number"
            min={30}
            max={600}
            step={10}
            value={Math.round(settings.aiTimeoutMs / 1000)}
            onChange={(e) =>
              onChange({
                ...settings,
                aiTimeoutMs: Math.max(30, Number(e.target.value) || 180) * 1000,
              })
            }
          />
        </div>
        <div className="setting-row">
          <label>
            <input
              type="checkbox"
              checked={settings.aiShowReasoningStream}
              onChange={(e) =>
                onChange({
                  ...settings,
                  aiShowReasoningStream: e.target.checked,
                })
              }
            />{' '}
            流式输出 Thinking 内容（采集日志中显示 [AI][think] 行）
          </label>
        </div>
        <div className="setting-row setting-row-stack">
          <div className="setting-row-header">
            <label>System Prompt（AILog 润色指令）</label>
            <button
              type="button"
              className="btn secondary btn-compact"
              onClick={() =>
                onChange({
                  ...settings,
                  aiSystemPrompt: settings.aiSystemPromptDefault,
                })
              }
            >
              重置为默认
            </button>
          </div>
          <textarea
            className="settings-prompt-textarea"
            rows={12}
            value={settings.aiSystemPrompt}
            onChange={(e) =>
              onChange({ ...settings, aiSystemPrompt: e.target.value })
            }
            spellCheck={false}
          />
          <p className="setting-hint">
            修改后点「保存」生效；「重置为默认」恢复内置 prompt（保存后不再使用自定义）。
          </p>
        </div>
        <SecretField
          label="API Key"
          meta={secrets.apiKey}
          editValue={apiKeyEdit}
          revealedValue={revealed.apiKey ?? null}
          onEditChange={onApiKeyEdit}
          onReveal={() => onReveal('apiKey')}
          onHide={() => onHide('apiKey')}
          placeholder="sk-..."
        />
      </section>
    </div>
    <footer className="overlay-footer">
      <button type="button" className="btn" onClick={() => onSave(apiKeyEdit, '')}>
        保存
      </button>
    </footer>
  </section>
);
