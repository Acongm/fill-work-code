import type { Database } from '../../database/types/database';
import {
  ProjectionRepository,
  type ProjectionGroup,
} from '../../database/commands/projectionRepository';
import type { WorkLogManager } from '../utils/workLogManager';
import { GeneratedDailyProjector } from './generatedDailyProjector';

export interface SyncGeneratedJsonResult {
  projected: ProjectionGroup[];
  skipped: ProjectionGroup[];
}

function hasStructuredCoverage(
  database: Database,
  projections: ProjectionRepository,
  date: string,
  group: ProjectionGroup,
): boolean {
  if (projections.get(date, group)) {
    return true;
  }
  if (group === 'git') {
    return Boolean(
      database.get<{ count: number }>(
        `SELECT (
           (SELECT COUNT(*) FROM gitlog_entries WHERE date = ?) +
           (SELECT COUNT(*) FROM commits
             WHERE substr(committed_at, 1, 10) = ?)
         ) AS count`,
        [date, date],
      )?.count,
    );
  }
  return Boolean(
    database.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM daily_items
       WHERE date = ? AND kind = 'ailog' AND source = 'ai'`,
      [date],
    )?.count,
  );
}

export async function syncGeneratedJson(
  database: Database,
  workLogManager: WorkLogManager,
  date: string,
  groups: ProjectionGroup[],
  onLog?: (line: string) => void,
): Promise<SyncGeneratedJsonResult> {
  const projections = new ProjectionRepository(database);
  const projector = new GeneratedDailyProjector(
    database,
    workLogManager,
    onLog,
  );
  const result: SyncGeneratedJsonResult = {
    projected: [],
    skipped: [],
  };
  for (const group of [...new Set(groups)]) {
    if (!hasStructuredCoverage(database, projections, date, group)) {
      result.skipped.push(group);
      onLog?.(`[JSON] ${date} ${group} 尚无结构化覆盖记录，跳过同步`);
      continue;
    }
    await projector.project(date, [group]);
    result.projected.push(group);
  }
  return result;
}

export async function retryPendingProjections(
  database: Database,
  workLogManager: WorkLogManager,
  onLog?: (line: string) => void,
): Promise<number> {
  const pending = new ProjectionRepository(database).listPending();
  const projector = new GeneratedDailyProjector(
    database,
    workLogManager,
    onLog,
  );
  let completed = 0;
  for (const state of pending) {
    await projector.project(
      state.date,
      [state.group],
      state.sourceRevision || Date.now(),
    );
    completed += 1;
  }
  return completed;
}
