import * as React from 'react';
import { useEffect, useState } from 'react';
import { OverlayHeader } from '../../shared/views/OverlayHeader';
import { CloneTagBar } from '../views/CloneTagBar';
import { ProjectCommitDay } from '../views/ProjectCommitDay';
import type {
  ProjectDailyLogsGeneratedMessage,
  ProjectHistory,
} from '../types/projectHistory';
import type { RepoGroup } from '@host-utils/types/repoRegistry';
import { normalizeCommitDay } from '@host-utils/utils/dateFormat';
import { remainingSelectedDates } from '@host-utils/utils/projectDateSelection';
import { vscode } from '../../shared/utils/vscodeApi';

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
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [expandedDates, setExpandedDates] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationFailures, setGenerationFailures] = useState<
    Array<{ date: string; message: string }>
  >([]);

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
      if (
        data.command === 'projectDailyLogsGenerated' &&
        data.originUrl === group.originUrl
      ) {
        const result = data as ProjectDailyLogsGeneratedMessage;
        setSelectedDates((current) =>
          remainingSelectedDates(current, result.generatedDates || []),
        );
        setGenerationFailures(result.failures || []);
        setGenerating(false);
        vscode.postMessage({
          command: 'getRepoDetail',
          originUrl: group.originUrl,
          cloneId: activeTag === 'all' ? undefined : activeTag,
        });
      }
    };
    window.addEventListener('message', handler);
    setSelectedDates([]);
    setGenerationFailures([]);
    vscode.postMessage({
      command: 'getRepoDetail',
      originUrl: group.originUrl,
      cloneId: activeTag === 'all' ? undefined : activeTag,
    });
    return () => window.removeEventListener('message', handler);
  }, [group.originUrl, activeTag]);

  const setDateSelected = (date: string, selected: boolean) => {
    setSelectedDates((current) => {
      if (selected) {
        return current.includes(date) ? current : [...current, date].sort();
      }
      return current.filter((item) => item !== date);
    });
  };

  const setDateExpanded = (date: string, expanded: boolean) => {
    setExpandedDates((current) => {
      if (expanded) {
        return current.includes(date) ? current : [...current, date];
      }
      return current.filter((item) => item !== date);
    });
  };

  const generateDailyLogs = () => {
    if (selectedDates.length === 0 || generating) {
      return;
    }
    setGenerating(true);
    setGenerationFailures([]);
    vscode.postMessage({
      command: 'generateProjectDailyLogs',
      originUrl: group.originUrl,
      dates: selectedDates.map(normalizeCommitDay),
    });
  };

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

        <section className="repo-activity-section">
          <div className="repo-activity-toolbar">
            <h4>工作日志</h4>
            <button
              type="button"
              className="btn"
              disabled={generating || selectedDates.length === 0}
              onClick={generateDailyLogs}
            >
              {generating
                ? '生成中…'
                : `生成单日工作日志 (${selectedDates.length})`}
            </button>
          </div>
          {generationFailures.length > 0 && (
            <div className="repo-generation-errors">
              {generationFailures.map((failure) => (
                <div key={`${failure.date}:${failure.message}`}>
                  {failure.date || '请求'}：{failure.message}
                </div>
              ))}
            </div>
          )}
          {!history || history.days.length === 0 ? (
            <p className="empty-hint">暂无项目活动</p>
          ) : (
            history.days.map((day) => (
              <ProjectCommitDay
                key={day.date}
                day={day}
                selected={selectedDates.includes(day.date)}
                expanded={expandedDates.includes(day.date)}
                disabled={generating}
                onSelectedChange={setDateSelected}
                onExpandedChange={setDateExpanded}
              />
            ))
          )}
        </section>
      </div>
    </section>
  );
};
