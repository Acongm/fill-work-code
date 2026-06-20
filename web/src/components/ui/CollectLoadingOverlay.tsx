import * as React from 'react';
import { useEffect, useRef } from 'react';

export interface CollectLoadingState {
  active: boolean;
  title: string;
  status: string;
  feedItems: string[];
}

interface CollectLoadingOverlayProps {
  loading: CollectLoadingState;
  onCancel: () => void;
}

export const CollectLoadingOverlay: React.FC<CollectLoadingOverlayProps> = ({
  loading,
  onCancel,
}) => {
  const consoleRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [loading.feedItems.length, loading.feedItems]);

  if (!loading.active) {
    return null;
  }

  const text = loading.feedItems.length > 0 ? loading.feedItems.join('\n') : '';

  return (
    <section className="collect-terminal-overlay">
      <header className="collect-terminal-header">
        <div className="collect-terminal-title-wrap">
          <span className="collect-spinner" aria-hidden="true" />
          <span className="collect-terminal-title">{loading.title}</span>
        </div>
        <button type="button" className="btn btn--danger btn-sm" onClick={onCancel}>
          取消采集
        </button>
      </header>
      <p className="collect-terminal-hint">
        采集中请勿关闭面板；误触可点「取消采集」。下方为实时终端输出（含 [progress] 行）。
      </p>
      <pre ref={consoleRef} className="collect-terminal-console">
        {text || `[等待输出…]\n${loading.status || ''}\n`}
      </pre>
    </section>
  );
};
