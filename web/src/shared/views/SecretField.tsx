import * as React from 'react';

export interface SecretMeta {
  configured: boolean;
  masked: string;
}

interface SecretFieldProps {
  label: string;
  meta: SecretMeta;
  editValue: string;
  revealedValue: string | null;
  onEditChange: (value: string) => void;
  onReveal: () => void;
  onHide: () => void;
  placeholder?: string;
}

export const SecretField: React.FC<SecretFieldProps> = ({
  label,
  meta,
  editValue,
  revealedValue,
  onEditChange,
  onReveal,
  onHide,
  placeholder,
}) => {
  const [editing, setEditing] = React.useState(false);
  const showing = revealedValue !== null;

  return (
    <div className="secret-field">
      <div className="secret-field-head">
        <label>{label}</label>
        <span className={`secret-badge${meta.configured ? ' is-on' : ''}`}>
          {meta.configured ? '已配置' : '未配置'}
        </span>
      </div>
      {!editing && !showing && (
        <div className="secret-field-display">
          <code className="secret-masked">
            {meta.configured ? meta.masked : '（未配置）'}
          </code>
          <div className="secret-field-actions">
            {meta.configured && (
              <button type="button" className="btn btn--ghost btn-sm" onClick={onReveal}>
                查看
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn-sm"
              onClick={() => setEditing(true)}
            >
              修改
            </button>
          </div>
        </div>
      )}
      {showing && (
        <div className="secret-field-reveal">
          <pre className="secret-reveal-text">{revealedValue}</pre>
          <button type="button" className="btn btn--ghost btn-sm" onClick={onHide}>
            隐藏
          </button>
        </div>
      )}
      {editing && (
        <div className="secret-field-edit">
          <input
            type="password"
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            placeholder={placeholder || (meta.configured ? '留空则不修改' : '请输入')}
          />
          <button type="button" className="btn btn--ghost btn-sm" onClick={() => setEditing(false)}>
            完成
          </button>
        </div>
      )}
    </div>
  );
};
