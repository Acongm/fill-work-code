import * as React from 'react';

export type CollectView = 'day' | 'workWeek' | 'custom';

interface ScopeToggleProps {
  value: CollectView;
  onChange: (v: CollectView) => void;
}

export const ScopeToggle: React.FC<ScopeToggleProps> = ({ value, onChange }) => (
  <div className="scope-toggle" role="group" aria-label="采集范围">
    <button
      type="button"
      className={`scope-toggle-btn${value === 'day' ? ' active' : ''}`}
      onClick={() => onChange('day')}
    >
      单日
    </button>
    <button
      type="button"
      className={`scope-toggle-btn${value === 'workWeek' ? ' active' : ''}`}
      onClick={() => onChange('workWeek')}
    >
      本周
    </button>
    <button
      type="button"
      className={`scope-toggle-btn${value === 'custom' ? ' active' : ''}`}
      onClick={() => onChange('custom')}
    >
      自定义
    </button>
  </div>
);
