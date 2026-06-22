import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { OverlayHeader } from '../../components/ui/OverlayHeader';
import { CloneTagBar } from '../../components/repo/CloneTagBar';
import type { RepoGroup } from '@host-utils/types/repoRegistry';
import { vscode } from '../../vscodeApi';

interface RepoActivity {
  commits: Array<{
    date: string;
    sha: string;
    subject: string;
    repoRoot: string;
  }>;
  gitlogLines: Array<{ date: string; line: string }>;
  ailogLines: Array<{ date: string; line: string }>;
}

interface RepoDetailOverlayProps {
  group: RepoGroup;
  onBack: () => void;
}

function groupLinesByDate(lines: Array<{ date: string; line: string }>) {
  const map = new Map<string, string[]>();
  for (const item of lines) {
    const list = map.get(item.date) ?? [];
    list.push(item.line);
    map.set(item.date, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({ date, items }));
}

export const RepoDetailOverlay: React.FC<RepoDetailOverlayProps> = ({
  group,
  onBack,
}) => {
  const [activeTag, setActiveTag] = useState('all');
  const [activity, setActivity] = useState<RepoActivity | null>(null);
  const [showCommits, setShowCommits] = useState(false);

  const tags = [
    { id: 'all', label: '全部' },
    ...group.clones.map((c) => ({ id: c.id, label: c.cloneLabel })),
  ];

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data.command === 'repoDetail' && data.group?.originUrl === group.originUrl) {
        setActivity(data.activity || null);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({
      command: 'getRepoDetail',
      originUrl: group.originUrl,
      cloneId: activeTag === 'all' ? undefined : activeTag,
    });
    return () => window.removeEventListener('message', handler);
  }, [group.originUrl, activeTag]);

  const ailogByDate = useMemo(
    () => groupLinesByDate(activity?.ailogLines || []),
    [activity?.ailogLines],
  );

  return (
    <section className="page-overlay repo-detail-overlay">
      <OverlayHeader title={group.repoName} onBack={onBack} />
      <div className="overlay-body">
        <p className="repo-detail-origin">{group.originUrl}</p>
        <div className="repo-clone-actions">
          {group.clones.map((c) => (
            <button
              key={c.id}
              type="button"
              className="btn secondary btn-sm"
              onClick={() =>
                vscode.postMessage({ command: 'openRepoInVscode', repoId: c.id })
              }
            >
              打开 {c.cloneLabel}
            </button>
          ))}
        </div>
        <CloneTagBar tags={tags} activeId={activeTag} onChange={setActiveTag} />

        <section className="repo-activity-section repo-activity-primary">
          <h4>AILog 汇总</h4>
          {ailogByDate.length === 0 ? (
            <p className="empty-hint">暂无 AILog 记录</p>
          ) : (
            ailogByDate.map((grouped) => (
              <div key={grouped.date} className="repo-day-group">
                <div className="repo-day-heading">{grouped.date}</div>
                {grouped.items.map((line, index) => (
                  <div key={`${grouped.date}-${index}`} className="repo-ailog-line">
                    {line}
                  </div>
                ))}
              </div>
            ))
          )}
        </section>

        <section className="repo-activity-section repo-activity-secondary">
          <button
            type="button"
            className="btn secondary btn-sm repo-toggle-commits"
            onClick={() => setShowCommits((prev) => !prev)}
          >
            {showCommits ? '收起 Commits' : `展开 Commits (${activity?.commits.length || 0})`}
          </button>
          {showCommits &&
            (activity?.commits || []).slice(0, 100).map((c) => (
              <div key={`${c.sha}-${c.date}`} className="repo-commit-line">
                <span className="repo-commit-date">{c.date}</span>
                <code>{c.sha.slice(0, 8)}</code> {c.subject}
              </div>
            ))}
        </section>
      </div>
    </section>
  );
};
