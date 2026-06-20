import * as React from 'react';
import { OverlayHeader } from '../../components/ui/OverlayHeader';
import type { PluginSettingsForm } from '../settings/SettingsOverlay';
import { SecretField, type SecretMeta } from '../../components/ui/SecretField';

interface ProfileOverlayProps {
  settings: PluginSettingsForm;
  secrets: { apiKey: SecretMeta; emailPassword: SecretMeta };
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

export const ProfileOverlay: React.FC<ProfileOverlayProps> = ({
  settings,
  secrets,
  onChange,
  onSave,
  onClose,
  apiKeyEdit,
  emailPasswordEdit,
  onApiKeyEdit,
  onEmailPasswordEdit,
  revealed,
  onReveal,
  onHide,
}) => (
  <section className="page-overlay settings-overlay-page">
    <OverlayHeader title="个人中心" onBack={onClose} />
    <div className="overlay-body settings-overlay-body">
      <section className="settings-section">
        <h3>导出与显示</h3>
        <div className="setting-row">
          <label>显示姓名（工时表/交付物文件名）</label>
          <input
            value={settings.displayName}
            onChange={(e) => onChange({ ...settings, displayName: e.target.value })}
          />
        </div>
        <div className="setting-row">
          <label>生成输出目录（留空则用存储目录）</label>
          <input
            value={settings.outputDir}
            onChange={(e) => onChange({ ...settings, outputDir: e.target.value })}
          />
        </div>
        <div className="setting-row">
          <label>工时表内容字段</label>
          <select
            value={settings.timesheetContentField}
            onChange={(e) =>
              onChange({ ...settings, timesheetContentField: e.target.value })
            }
          >
            <option value="ailog">ailog</option>
            <option value="completed">completed</option>
            <option value="gitlog">gitlog</option>
            <option value="gitCommit">gitCommit</option>
          </select>
        </div>
        <div className="setting-row">
          <label className="setting-checkbox-label">
            <input
              type="checkbox"
              checked={settings.dailySyncFieldVisibility}
              onChange={(e) =>
                onChange({ ...settings, dailySyncFieldVisibility: e.target.checked })
              }
            />
            <span>日报同步字段显示控制（关闭时日报显示全部字段）</span>
          </label>
        </div>
        <div className="setting-row setting-row-stack">
          <label>汇总额外显示字段（完成 / AILog / 相关仓库始终显示）</label>
          <div className="field-checkbox-group">
            {(
              [
                ['gitlog', 'GitLog'],
                ['gitCommit', 'GitCommit'],
                ['plan', '明日计划'],
                ['blockers', '阻碍/问题'],
                ['notes', '备注'],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="setting-checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.visibleFields.includes(field)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...settings.visibleFields, field]
                      : settings.visibleFields.filter((f) => f !== field);
                    onChange({ ...settings, visibleFields: next });
                  }}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      </section>
      <section className="settings-section">
        <h3>邮件</h3>
        <div className="setting-row">
          <label>SMTP Host</label>
          <input
            value={settings.email.smtpHost}
            onChange={(e) =>
              onChange({
                ...settings,
                email: { ...settings.email, smtpHost: e.target.value },
              })
            }
          />
        </div>
        <div className="setting-row">
          <label>发件人 / 收件人</label>
          <input
            value={settings.email.from}
            placeholder="from"
            onChange={(e) =>
              onChange({
                ...settings,
                email: { ...settings.email, from: e.target.value },
              })
            }
          />
          <input
            style={{ marginTop: 4 }}
            value={settings.email.to}
            placeholder="to"
            onChange={(e) =>
              onChange({
                ...settings,
                email: { ...settings.email, to: e.target.value },
              })
            }
          />
        </div>
        <SecretField
          label="邮件密码"
          meta={secrets.emailPassword}
          editValue={emailPasswordEdit}
          revealedValue={revealed.emailPassword ?? null}
          onEditChange={onEmailPasswordEdit}
          onReveal={() => onReveal('emailPassword')}
          onHide={() => onHide('emailPassword')}
        />
      </section>
    </div>
    <footer className="overlay-footer">
      <button type="button" className="btn" onClick={() => onSave(apiKeyEdit, emailPasswordEdit)}>
        保存
      </button>
    </footer>
  </section>
);
