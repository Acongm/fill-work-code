import * as crypto from 'crypto';
import type { DailyLog, DailyProjectLink } from '../../shared/types/dailyLog';
import type {
  ProjectHistory,
  ProjectHistoryDay,
} from '../../database/commands/projectRepository';
import type { DailyItem } from '../../database/commands/dailyItemRepository';

function itemKind(field: DailyProjectLink['field']): DailyItem['kind'] {
  switch (field) {
    case 'plan':
      return 'todo';
    case 'blockers':
      return 'blocker';
    case 'notes':
      return 'note';
    default:
      return 'completed';
  }
}

function stableJsonItemId(date: string, link: DailyProjectLink): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${date}:${link.field}:${link.content}`)
    .digest('hex')
    .slice(0, 24);
  return `json:${digest}`;
}

export function mergeJsonProjectHistory(
  history: ProjectHistory,
  logs: DailyLog[],
  projectOriginUrl: string,
): ProjectHistory {
  const days = new Map<string, ProjectHistoryDay>(
    history.days.map((day) => [
      day.date,
      {
        ...day,
        commits: [...day.commits],
        gitlog: [...day.gitlog],
        items: [...day.items],
      },
    ]),
  );
  const ensureDay = (date: string): ProjectHistoryDay => {
    const existing = days.get(date);
    if (existing) {
      return existing;
    }
    const created: ProjectHistoryDay = {
      date,
      commits: [],
      gitlog: [],
      items: [],
    };
    days.set(date, created);
    return created;
  };

  for (const log of logs) {
    for (const link of log.projectLinks || []) {
      if (
        link.assignment !== 'project' ||
        link.projectOriginUrl !== projectOriginUrl
      ) {
        continue;
      }
      const timestamp = `${log.date}T12:00:00.000Z`;
      ensureDay(log.date).items.push({
        id: stableJsonItemId(log.date, link),
        date: log.date,
        kind: itemKind(link.field),
        content: link.content,
        assignment: 'project',
        projectId: history.project.id,
        source: 'manual',
        sortOrder: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  return {
    ...history,
    days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
  };
}
