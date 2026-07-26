import * as React from 'react';
import { useEffect, useState } from 'react';
import { RepoListItem } from '../views/RepoListItem';
import type { RepoGroup } from '@host-utils/types/repoRegistry';
import { vscode } from '../../shared/utils/vscodeApi';

interface RepoListViewProps {
  onSelectGroup: (group: RepoGroup) => void;
}

export const RepoListView: React.FC<RepoListViewProps> = ({ onSelectGroup }) => {
  const [groups, setGroups] = useState<RepoGroup[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data.command === 'reposListed') {
        setGroups(data.groups || []);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ command: 'listRepos' });
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      vscode.postMessage({ command: 'listRepos', search: search.trim() || undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="repo-list-view">
      <div className="setting-row">
        <input
          className="input"
          placeholder="搜索仓库名 / origin / 路径"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {groups.length === 0 ? (
        <p className="empty-hint">暂无仓库记录，请先执行 Git 采集。</p>
      ) : (
        groups.map((g) => (
          <RepoListItem
            key={g.originUrl}
            group={g}
            onOpen={() => onSelectGroup(g)}
            onOpenVscode={
              g.cloneCount === 1
                ? () =>
                    vscode.postMessage({
                      command: 'openRepoInVscode',
                      repoId: g.clones[0].id,
                    })
                : undefined
            }
            onPin={(pinned) =>
              vscode.postMessage({
                command: 'updateRepo',
                repoId: g.clones[0].id,
                pinned,
              })
            }
            onHide={() =>
              vscode.postMessage({
                command: 'updateRepo',
                repoId: g.clones[0].id,
                hidden: true,
              })
            }
          />
        ))
      )}
    </div>
  );
};
