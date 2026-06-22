import * as React from 'react';

interface CloneTagBarProps {
  tags: Array<{ id: string; label: string }>;
  activeId: string;
  onChange: (id: string) => void;
}

export const CloneTagBar: React.FC<CloneTagBarProps> = ({
  tags,
  activeId,
  onChange,
}) => (
  <div className="clone-tag-bar" role="tablist">
    {tags.map((tag) => (
      <button
        key={tag.id}
        type="button"
        role="tab"
        className={`clone-tag${activeId === tag.id ? ' active' : ''}`}
        onClick={() => onChange(tag.id)}
      >
        {tag.label}
      </button>
    ))}
  </div>
);
