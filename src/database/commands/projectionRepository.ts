import type { Database } from '../types/database';

export type ProjectionGroup = 'git' | 'ai';
export type ProjectionStatus = 'pending' | 'projected' | 'failed';

export interface ProjectionState {
  date: string;
  group: ProjectionGroup;
  sourceRevision: number;
  projectedRevision: number;
  status: ProjectionStatus;
  lastError: string | null;
}

interface ProjectionStateRow {
  date: string;
  field_group: ProjectionGroup;
  source_revision: number;
  projected_revision: number;
  status: ProjectionStatus;
  last_error: string | null;
}

function mapRow(row: ProjectionStateRow): ProjectionState {
  return {
    date: row.date,
    group: row.field_group,
    sourceRevision: row.source_revision,
    projectedRevision: row.projected_revision,
    status: row.status,
    lastError: row.last_error,
  };
}

export class ProjectionRepository {
  constructor(private readonly database: Database) {}

  async markPending(
    date: string,
    group: ProjectionGroup,
    revision: number,
  ): Promise<void> {
    this.database.transaction(() => {
      this.database.execute(
        `INSERT INTO json_projection_state(
          date, field_group, source_revision, projected_revision,
          status, last_error, updated_at
        ) VALUES (?, ?, ?, 0, 'pending', NULL, ?)
        ON CONFLICT(date, field_group) DO UPDATE SET
          source_revision = excluded.source_revision,
          status = 'pending',
          last_error = NULL,
          updated_at = excluded.updated_at`,
        [date, group, revision, new Date().toISOString()],
      );
    });
    await this.database.flush();
  }

  async markProjected(
    date: string,
    group: ProjectionGroup,
    revision: number,
  ): Promise<void> {
    this.database.transaction(() => {
      this.database.execute(
        `UPDATE json_projection_state
         SET source_revision = ?,
             projected_revision = ?,
             status = 'projected',
             last_error = NULL,
             updated_at = ?
         WHERE date = ? AND field_group = ?`,
        [revision, revision, new Date().toISOString(), date, group],
      );
    });
    await this.database.flush();
  }

  async markFailed(
    date: string,
    group: ProjectionGroup,
    message: string,
  ): Promise<void> {
    this.database.transaction(() => {
      this.database.execute(
        `UPDATE json_projection_state
         SET status = 'failed', last_error = ?, updated_at = ?
         WHERE date = ? AND field_group = ?`,
        [message, new Date().toISOString(), date, group],
      );
    });
    await this.database.flush();
  }

  get(date: string, group: ProjectionGroup): ProjectionState | undefined {
    const row = this.database.get<ProjectionStateRow>(
      `SELECT date, field_group, source_revision, projected_revision,
              status, last_error
       FROM json_projection_state
       WHERE date = ? AND field_group = ?`,
      [date, group],
    );
    return row ? mapRow(row) : undefined;
  }

  listPending(): ProjectionState[] {
    return this.database
      .all<ProjectionStateRow>(
        `SELECT date, field_group, source_revision, projected_revision,
                status, last_error
         FROM json_projection_state
         WHERE status IN ('pending', 'failed')
         ORDER BY date, field_group`,
      )
      .map(mapRow);
  }
}
