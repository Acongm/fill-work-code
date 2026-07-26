import * as React from 'react';

export interface ParsedCommitLine {
  sha: string;
  subject: string;
  line: string;
}

export function parseGitCommitLine(line: string): ParsedCommitLine {
  const trimmed = line.trim();
  const match = trimmed.match(/^([0-9a-f]{7,40})\s+(.+)$/i);
  if (match) {
    return { sha: match[1], subject: match[2], line: trimmed };
  }
  return { sha: '', subject: trimmed, line: trimmed };
}

interface CommitItemProps {
  commit: ParsedCommitLine;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const CommitItem: React.FC<CommitItemProps> = ({
  commit,
  checked,
  onChange,
}) => (
  <label className="commit-item">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    {commit.sha ? <code>{commit.sha.slice(0, 8)}</code> : null}
    <span className="commit-item-subject">{commit.subject}</span>
  </label>
);

export function filterCommitLines(
  allLines: string[],
  selectedLines: Set<string>,
): string[] {
  return allLines.filter((line) => selectedLines.has(line.trim()));
}

export function syncGitlogWithCommits(
  gitlog: string[],
  gitCommit: string[],
  selectedLines: Set<string>,
): { gitlog: string[]; gitCommit: string[] } {
  const nextCommit = filterCommitLines(gitCommit, selectedLines);
  if (nextCommit.length === gitCommit.length) {
    return { gitlog, gitCommit: nextCommit };
  }
  const selectedSubjects = new Set(
    nextCommit.map((line) => parseGitCommitLine(line).subject),
  );
  const nextGitlog = gitlog.filter((line) => {
    const subjectMatch = line.match(/\]\s*(.+)$/);
    const subject = subjectMatch?.[1]?.split('；')[0]?.trim();
    if (!subject) {
      return true;
    }
    return selectedSubjects.has(subject) || [...selectedSubjects].some((s) => line.includes(s));
  });
  return { gitlog: nextGitlog, gitCommit: nextCommit };
}
