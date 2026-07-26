import type { Database } from '../types/database';

export type DailyItemKind =
  | 'completed'
  | 'ailog'
  | 'todo'
  | 'blocker'
  | 'note';
export type DailyItemAssignment = 'project' | 'unassigned';
export type DailyItemSource = 'manual' | 'ai' | 'migration';

export interface DailyItemInput {
  id: string;
  date: string;
  kind: DailyItemKind;
  content: string;
  assignment: DailyItemAssignment;
  projectId: string | null;
  source: DailyItemSource;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DailyItem extends Required<DailyItemInput> {}

interface DailyItemRow {
  id: string;
  date: string;
  kind: DailyItemKind;
  content: string;
  assignment: DailyItemAssignment;
  project_id: string | null;
  source: DailyItemSource;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DailyItemRow): DailyItem {
  return {
    id: row.id,
    date: row.date,
    kind: row.kind,
    content: row.content,
    assignment: row.assignment,
    projectId: row.project_id,
    source: row.source,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DailyItemRepository {
  constructor(private readonly database: Database) {}

  async insert(input: DailyItemInput): Promise<DailyItem> {
    const now = new Date().toISOString();
    const item: DailyItem = {
      ...input,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
    };
    this.database.transaction(() => {
      this.database.execute(
        `INSERT INTO daily_items(
          id, date, kind, content, assignment, project_id, source,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.date,
          item.kind,
          item.content,
          item.assignment,
          item.projectId,
          item.source,
          item.sortOrder,
          item.createdAt,
          item.updatedAt,
        ],
      );
    });
    await this.database.flush();
    return item;
  }

  async upsert(input: DailyItemInput): Promise<DailyItem> {
    const now = new Date().toISOString();
    const item: DailyItem = {
      ...input,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
    };
    this.database.transaction(() => {
      this.database.execute(
        `INSERT INTO daily_items(
          id, date, kind, content, assignment, project_id, source,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          date = excluded.date,
          kind = excluded.kind,
          content = excluded.content,
          assignment = excluded.assignment,
          project_id = excluded.project_id,
          source = excluded.source,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at`,
        [
          item.id,
          item.date,
          item.kind,
          item.content,
          item.assignment,
          item.projectId,
          item.source,
          item.sortOrder,
          item.createdAt,
          item.updatedAt,
        ],
      );
    });
    await this.database.flush();
    return item;
  }

  async replaceDate(date: string, items: DailyItemInput[]): Promise<void> {
    this.database.transaction(() => {
      this.database.execute('DELETE FROM daily_items WHERE date = ?', [date]);
      for (const input of items) {
        const now = new Date().toISOString();
        this.database.execute(
          `INSERT INTO daily_items(
            id, date, kind, content, assignment, project_id, source,
            sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.id,
            date,
            input.kind,
            input.content,
            input.assignment,
            input.projectId,
            input.source,
            input.sortOrder,
            input.createdAt || now,
            input.updatedAt || now,
          ],
        );
      }
    });
    await this.database.flush();
  }

  listByDate(date: string): DailyItem[] {
    return this.database
      .all<DailyItemRow>(
        `SELECT * FROM daily_items
         WHERE date = ?
         ORDER BY sort_order, created_at, id`,
        [date],
      )
      .map(mapRow);
  }

  listRange(startDate: string, endDate: string): DailyItem[] {
    return this.database
      .all<DailyItemRow>(
        `SELECT * FROM daily_items
         WHERE date BETWEEN ? AND ?
         ORDER BY date, sort_order, created_at, id`,
        [startDate, endDate],
      )
      .map(mapRow);
  }

  listForProject(projectId: string): DailyItem[] {
    return this.database
      .all<DailyItemRow>(
        `SELECT * FROM daily_items
         WHERE project_id = ?
         ORDER BY date DESC, sort_order, created_at, id`,
        [projectId],
      )
      .map(mapRow);
  }

  async delete(id: string): Promise<void> {
    this.database.transaction(() => {
      this.database.execute('DELETE FROM daily_items WHERE id = ?', [id]);
    });
    await this.database.flush();
  }
}
