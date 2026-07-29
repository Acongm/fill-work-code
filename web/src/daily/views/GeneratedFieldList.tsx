import * as React from 'react';

interface GeneratedFieldListProps {
  label: string;
  items: string[];
  sourceHint?: string;
}

export const GeneratedFieldList: React.FC<GeneratedFieldListProps> = ({
  label,
  items,
  sourceHint = 'SQLite 生成 · JSON 只读',
}) => {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <section className="generated-field">
      <div className="generated-field__header">
        <div>
          <strong>{label}</strong>
          <span className="generated-field__source">
            {items.length} 条 · {sourceHint}
          </span>
        </div>
        <button
          type="button"
          className="generated-field__toggle btn btn--ghost btn-sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>
      {expanded &&
        (items.length === 0 ? (
          <div className="generated-field__empty">暂无记录</div>
        ) : (
          <ul className="generated-field__list">
            {items.map((item, index) => (
              <li key={`${index}-${item.slice(0, 32)}`}>{item}</li>
            ))}
          </ul>
        ))}
    </section>
  );
};
