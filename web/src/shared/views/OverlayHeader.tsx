import * as React from 'react';

interface OverlayHeaderProps {
  title: string;
  onBack: () => void;
  backLabel?: string;
  trailing?: React.ReactNode;
}

export const OverlayHeader: React.FC<OverlayHeaderProps> = ({
  title,
  onBack,
  backLabel = '返回',
  trailing,
}) => (
  <header className="overlay-header">
    <button type="button" className="btn btn--ghost" onClick={onBack} title={backLabel}>
      ←
    </button>
    <h2 className="overlay-title">{title}</h2>
    {trailing ?? <span className="overlay-header-spacer" aria-hidden="true" />}
  </header>
);
