import * as React from 'react';

interface GeneratedFieldListProps {
  label: string;
  items: string[];
  onSyncToCompleted?: (items: string[], label: string) => void;
}

export const GeneratedFieldList: React.FC<GeneratedFieldListProps> = ({
  label,
  items,
  onSyncToCompleted,
}) => (
  <section className="generated-field">
    <div className="generated-field__header">
      <div>
        <strong>{label}</strong>
        <span className="generated-field__source">SQLite 生成 · JSON 只读</span>
      </div>
      {onSyncToCompleted && items.length > 0 && (
        <button
          type="button"
          className="btn secondary btn-sm"
          onClick={() => onSyncToCompleted(items, label)}
        >
          同步到今日完成
        </button>
      )}
    </div>
    {items.length === 0 ? (
      <div className="generated-field__empty">暂无记录</div>
    ) : (
      <ul className="generated-field__list">
        {items.map((item, index) => (
          <li key={`${index}-${item.slice(0, 32)}`}>{item}</li>
        ))}
      </ul>
    )}
  </section>
);
