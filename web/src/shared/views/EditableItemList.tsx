import * as React from 'react';

interface EditableItemListProps {
  label: string;
  hint?: string;
  items: string[];
  readOnly?: boolean;
  onChange: (items: string[]) => void;
  placeholder?: string;
  renderItemMeta?: (
    item: string,
    idx: number,
    isEditing: boolean,
  ) => React.ReactNode;
}

export const EditableItemList: React.FC<EditableItemListProps> = ({
  label,
  hint,
  items,
  readOnly = false,
  onChange,
  placeholder = '输入后回车添加',
  renderItemMeta,
}) => {
  const [draft, setDraft] = React.useState('');
  const [editIdx, setEditIdx] = React.useState<number | null>(null);
  const [editVal, setEditVal] = React.useState('');

  const addItem = () => {
    const val = draft.trim();
    if (!val) {
      return;
    }
    if (!items.includes(val)) {
      onChange([...items, val]);
    }
    setDraft('');
  };

  const saveEdit = () => {
    if (editIdx === null || !editVal.trim()) {
      setEditIdx(null);
      return;
    }
    onChange(items.map((item, i) => (i === editIdx ? editVal.trim() : item)));
    setEditIdx(null);
    setEditVal('');
  };

  return (
    <div className="editable-item-list">
      <div className="editable-item-list-head">
        <label>{label}</label>
        {hint && <span className="editable-item-hint">{hint}</span>}
      </div>
      <ul className="editable-item-rows">
        {items.length === 0 ? (
          <li className="editable-item-empty">暂无条目</li>
        ) : (
          items.map((item, idx) => {
            const isEditing = editIdx === idx && !readOnly;
            return (
              <li
                key={`${idx}-${item.slice(0, 24)}`}
                className="editable-item-row"
              >
                <div className="editable-item-row-main">
                  {isEditing ? (
                    <>
                      <input
                        className="editable-item-input"
                        value={editVal}
                        onChange={(e) => setEditVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            saveEdit();
                          } else if (e.key === 'Escape') {
                            setEditIdx(null);
                          }
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn btn--ghost btn-sm"
                        onClick={saveEdit}
                      >
                        ✓
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="editable-item-text">{item}</span>
                      {!readOnly && (
                        <>
                          <button
                            type="button"
                            className="btn btn--ghost btn-sm"
                            onClick={() => {
                              setEditIdx(idx);
                              setEditVal(item);
                            }}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn-sm"
                            onClick={() =>
                              onChange(items.filter((_, i) => i !== idx))
                            }
                          >
                            删除
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
                {renderItemMeta?.(item, idx, isEditing)}
              </li>
            );
          })
        )}
      </ul>
      {!readOnly && (
        <div className="editable-item-add">
          <input
            className="editable-item-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addItem();
              }
            }}
            placeholder={placeholder}
          />
          <button type="button" className="btn secondary btn-sm" onClick={addItem}>
            添加
          </button>
        </div>
      )}
    </div>
  );
};
