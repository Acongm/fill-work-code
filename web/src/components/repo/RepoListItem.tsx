import * as React from 'react';
import type { RepoGroup } from '@host-utils/types/repoRegistry';

interface RepoListItemProps {
  group: RepoGroup;
  onOpen: () => void;
  onOpenVscode?: () => void;
  onPin?: (pinned: boolean) => void;
  onHide?: () => void;
}

export const RepoListItem: React.FC<RepoListItemProps> = ({
  group,
  onOpen,
  onOpenVscode,
  onPin,
  onHide,
}) => {
  const primaryClone = group.clones[0];
  const isPinned = group.clones.some((c) => c.pinned);

  return (
    <div className="repo-list-item" onClick={onOpen} role="button" tabIndex={0}>
      <div className="repo-list-item-main">
        <strong>
          {isPinned ? '📌 ' : ''}
          {group.repoName}
        </strong>
        {group.cloneCount > 1 && (
          <span className="repo-clone-badge">{group.cloneCount} clones</span>
        )}
        <div className="repo-list-item-url">{group.originUrl}</div>
        {group.lastCommitAt && (
          <div className="repo-list-item-meta">最近 commit: {group.lastCommitAt}</div>
        )}
      </div>
      <div className="repo-list-item-actions" onClick={(e) => e.stopPropagation()}>
        {onPin && primaryClone && (
          <button
            type="button"
            className="btn secondary btn-sm"
            title={isPinned ? '取消置顶' : '置顶'}
            onClick={() => onPin(!isPinned)}
          >
            {isPinned ? '取消置顶' : '置顶'}
          </button>
        )}
        {onHide && primaryClone && (
          <button
            type="button"
            className="btn secondary btn-sm"
            title="从列表隐藏"
            onClick={onHide}
          >
            隐藏
          </button>
        )}
        {group.cloneCount === 1 && onOpenVscode && (
          <button type="button" className="btn secondary btn-sm" onClick={onOpenVscode}>
            打开
          </button>
        )}
      </div>
    </div>
  );
};
