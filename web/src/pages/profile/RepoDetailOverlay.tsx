import * as React from 'react';
import { useEffect, useState } from 'react';
import { OverlayHeader } from '../../components/ui/OverlayHeader';
import { CloneTagBar } from '../../components/repo/CloneTagBar';
import type { RepoGroup } from '@host-utils/types/repoRegistry';
import { vscode } from '../../vscodeApi';

interface ProjectHistory {
  days: Array<{
    date: string;
    commits: Array<{
      id: string;
      cloneId: string;
      committedAt: string;
      sha: string;
      subject: string;
    }>;
    gitlog: Array<{ id: string; content: string }>;
    items: Array<{
      id: string;
      kind: 'completed' | 'ailog' | 'todo' | 'blocker' | 'note';
      content: string;
      assignment: 'project' | 'unassigned';
    }>;
  }>;
}

interface LegacyCommit {
    date?: string;
    sha: string;
    subject: string;
}

interface RepoDetailOverlayProps {
  group: RepoGroup;
  onBack: () => void;
}

export const RepoDetailOverlay: React.FC<RepoDetailOverlayProps> = ({
  group,
  onBack,
}) => {
  const [activeTag, setActiveTag] = useState('all');
  const [history, setHistory] = useState<ProjectHistory | null>(null);
  const [showCommits, setShowCommits] = useState(false);

  const tags = [
    { id: 'all', label: '全部' },
    ...group.clones.map((c) => ({ id: c.id, label: c.cloneLabel })),
  ];

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data.command === 'repoDetail' && data.group?.originUrl === group.originUrl) {
        setHistory(data.history || null);
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

  const commits = (history?.days || []).flatMap((day) =>
    day.commits.map((commit) => ({ ...commit, date: day.date })),
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
          <h4>项目每日记录</h4>
          {!history || history.days.length === 0 ? (
            <p className="empty-hint">暂无项目活动</p>
          ) : (
            history.days.map((day) => (
              <div key={day.date} className="repo-day-group">
                <div className="repo-day-heading">{day.date}</div>
                {day.gitlog.map((entry) => (
                  <div key={entry.id} className="repo-ailog-line">
                    <strong>GitLog</strong> {entry.content}
                  </div>
                ))}
                {day.items.map((item) => (
                  <div key={item.id} className="repo-ailog-line">
                    <strong>{item.kind}</strong> {item.content}
                    {item.assignment === 'unassigned' && '（未归属）'}
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
            {showCommits ? '收起 Commits' : `展开 Commits (${commits.length})`}
          </button>
          {showCommits &&
            commits.slice(0, 100).map((c: LegacyCommit) => (
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
