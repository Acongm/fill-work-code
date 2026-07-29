import * as React from 'react';
import type { ProjectHistoryDay } from '../types/projectHistory';

interface ProjectCommitDayProps {
  day: ProjectHistoryDay;
  selected: boolean;
  expanded: boolean;
  disabled: boolean;
  onSelectedChange: (date: string, selected: boolean) => void;
  onExpandedChange: (date: string, expanded: boolean) => void;
}

function commitTime(committedAt: string): string {
  const date = new Date(committedAt);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const ProjectCommitDay: React.FC<ProjectCommitDayProps> = ({
  day,
  selected,
  expanded,
  disabled,
  onSelectedChange,
  onExpandedChange,
}) => {
  const hasCommits = day.commits.length > 0;

  return (
    <article className="repo-day-group">
      <div className="repo-day-heading">
        <div className="repo-day-heading-main">
          {hasCommits ? (
            <label className="repo-day-select">
              <input
                type="checkbox"
                checked={selected}
                disabled={disabled}
                onChange={(event) =>
                  onSelectedChange(day.date, event.target.checked)
                }
              />
              <span>{day.date}</span>
            </label>
          ) : (
            <span>{day.date}</span>
          )}
          <span className="repo-day-count">{day.commits.length} commits</span>
        </div>
        {hasCommits && (
          <button
            type="button"
            className="repo-day-toggle"
            aria-expanded={expanded}
            onClick={() => onExpandedChange(day.date, !expanded)}
          >
            {expanded ? '收起' : '展开'}
          </button>
        )}
      </div>

      {expanded && hasCommits && (
        <div className="repo-day-commits">
          {day.commits.map((commit) => (
            <div key={commit.id} className="repo-commit-line">
              <span className="repo-commit-time">
                {commitTime(commit.committedAt)}
              </span>
              <code>{commit.sha.slice(0, 8)}</code>
              <span>{commit.subject}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
};
