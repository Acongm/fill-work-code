import type { DailyLog } from '../../shared/types/dailyLog';
import type { ProjectionGroup } from '../../database/commands/projectionRepository';

export type GeneratedGitFields = Required<
  Pick<DailyLog, 'gitlog' | 'gitCommit' | 'origin_url'>
>;
export type GeneratedAiFields = Required<Pick<DailyLog, 'ailog'>>;

export interface GeneratedDailyJsonWriter {
  patchGeneratedFields(
    date: string,
    group: 'git',
    fields: GeneratedGitFields,
  ): Promise<void>;
  patchGeneratedFields(
    date: string,
    group: 'ai',
    fields: GeneratedAiFields,
  ): Promise<void>;
}

export interface ProjectionResult {
  date: string;
  groups: ProjectionGroup[];
}
