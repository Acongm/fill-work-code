import * as React from 'react';
import type { PluginSettingsForm } from '../../pages/settings/SettingsOverlay';
import {
  SETTINGS_FIELDS,
  type SettingFieldDef,
} from '@host-utils/settingsSchema';

interface SettingFieldProps {
  field: SettingFieldDef;
  settings: PluginSettingsForm;
  onChange: (settings: PluginSettingsForm) => void;
}

function readField(settings: PluginSettingsForm, key: string): unknown {
  if (key === 'timesheet.company') {
    return settings.timesheet?.company ?? '';
  }
  if (key === 'timesheet.approver') {
    return settings.timesheet?.approver ?? '';
  }
  return (settings as unknown as Record<string, unknown>)[key];
}

function writeField(
  settings: PluginSettingsForm,
  key: string,
  value: unknown,
): PluginSettingsForm {
  if (key === 'timesheet.company') {
    return {
      ...settings,
      timesheet: {
        company: String(value),
        approver: settings.timesheet?.approver ?? '',
        defaultHours: settings.timesheet?.defaultHours ?? 8,
      },
    };
  }
  if (key === 'timesheet.approver') {
    return {
      ...settings,
      timesheet: {
        company: settings.timesheet?.company ?? '',
        approver: String(value),
        defaultHours: settings.timesheet?.defaultHours ?? 8,
      },
    };
  }
  return { ...settings, [key]: value } as PluginSettingsForm;
}

export const SettingField: React.FC<SettingFieldProps> = ({
  field,
  settings,
  onChange,
}) => {
  const value = readField(settings, field.key);

  if (field.type === 'boolean') {
    return (
      <div className="setting-row">
        <label title={field.helpText}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) =>
              onChange(writeField(settings, field.key, e.target.checked))
            }
          />{' '}
          {field.label}
        </label>
        {field.helpText ? <p className="setting-hint">{field.helpText}</p> : null}
      </div>
    );
  }

  if (field.type === 'stringList') {
    return (
      <div className="setting-row">
        <label>{field.label}</label>
        <input
          className="input"
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) =>
            onChange(writeField(settings, field.key, e.target.value))
          }
        />
        {field.helpText ? <p className="setting-hint">{field.helpText}</p> : null}
      </div>
    );
  }

  if (field.type === 'text') {
    return (
      <div className="setting-row">
        <label>{field.label}</label>
        <input
          className="input"
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) =>
            onChange(writeField(settings, field.key, e.target.value))
          }
        />
      </div>
    );
  }

  if (field.type === 'select' && field.options) {
    return (
      <div className="setting-row">
        <label>{field.label}</label>
        <select
          className="select"
          value={String(value ?? '')}
          onChange={(e) =>
            onChange(writeField(settings, field.key, e.target.value))
          }
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return null;
};

export function SettingsFieldGroup(props: {
  section: SettingFieldDef['section'];
  settings: PluginSettingsForm;
  onChange: (settings: PluginSettingsForm) => void;
}) {
  const fields = SETTINGS_FIELDS.filter((f) => f.section === props.section);
  return (
    <>
      {fields.map((field) => (
        <SettingField
          key={field.key}
          field={field}
          settings={props.settings}
          onChange={props.onChange}
        />
      ))}
    </>
  );
}
