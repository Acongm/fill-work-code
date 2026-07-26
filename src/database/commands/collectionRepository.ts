import type { Database } from '../types/database';

export interface CollectionRunInput {
  id: string;
  scope: string;
  anchorDate: string;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  status: string;
  startedAt?: string;
  finishedAt?: string | null;
  error?: string | null;
}

export interface CommitInput {
  id: string;
  projectId: string;
  cloneId: string;
  sha: string;
  subject: string;
  author?: string | null;
  committedAt: string;
  collectionRunId?: string | null;
}

export interface GitlogEntryInput {
  id: string;
  date: string;
  projectId: string;
  cloneId?: string | null;
  content: string;
  collectionRunId?: string | null;
  commitIds?: string[];
}

export class CollectionRepository {
  constructor(private readonly database: Database) {}

  async upsertRun(input: CollectionRunInput): Promise<void> {
    this.database.transaction(() => {
      this.database.execute(
        `INSERT INTO collection_runs(
          id, scope, anchor_date, range_start, range_end, status,
          started_at, finished_at, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          scope = excluded.scope,
          anchor_date = excluded.anchor_date,
          range_start = excluded.range_start,
          range_end = excluded.range_end,
          status = excluded.status,
          finished_at = excluded.finished_at,
          error = excluded.error`,
        [
          input.id,
          input.scope,
          input.anchorDate,
          input.rangeStart ?? null,
          input.rangeEnd ?? null,
          input.status,
          input.startedAt || new Date().toISOString(),
          input.finishedAt ?? null,
          input.error ?? null,
        ],
      );
    });
    await this.database.flush();
  }

  async finishRun(
    id: string,
    status: string,
    error: string | null = null,
  ): Promise<void> {
    this.database.transaction(() => {
      this.database.execute(
        `UPDATE collection_runs
         SET status = ?, finished_at = ?, error = ?
         WHERE id = ?`,
        [status, new Date().toISOString(), error, id],
      );
    });
    await this.database.flush();
  }

  async upsertCommit(input: CommitInput): Promise<void> {
    this.database.transaction(() => {
      this.insertCommit(input);
    });
    await this.database.flush();
  }

  async insertGitlogEntry(input: GitlogEntryInput): Promise<void> {
    this.database.transaction(() => {
      this.insertGitlog(input);
    });
    await this.database.flush();
  }

  async saveFacts(
    commits: CommitInput[],
    entries: GitlogEntryInput[],
  ): Promise<void> {
    this.database.transaction(() => {
      for (const commit of commits) {
        this.insertCommit(commit);
      }
      for (const entry of entries) {
        this.insertGitlog(entry);
      }
    });
    await this.database.flush();
  }

  private insertCommit(input: CommitInput): void {
    this.database.execute(
      `INSERT INTO commits(
        id, project_id, clone_id, sha, subject, author,
        committed_at, collection_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(clone_id, sha) DO UPDATE SET
        subject = excluded.subject,
        author = excluded.author,
        committed_at = excluded.committed_at,
        collection_run_id = excluded.collection_run_id`,
      [
        input.id,
        input.projectId,
        input.cloneId,
        input.sha,
        input.subject,
        input.author ?? null,
        input.committedAt,
        input.collectionRunId ?? null,
      ],
    );
  }

  private insertGitlog(input: GitlogEntryInput): void {
    this.database.execute(
      `INSERT INTO gitlog_entries(
        id, date, project_id, clone_id, content, collection_run_id
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        date = excluded.date,
        project_id = excluded.project_id,
        clone_id = excluded.clone_id,
        content = excluded.content,
        collection_run_id = excluded.collection_run_id`,
      [
        input.id,
        input.date,
        input.projectId,
        input.cloneId ?? null,
        input.content,
        input.collectionRunId ?? null,
      ],
    );
    this.database.execute(
      'DELETE FROM gitlog_entry_commits WHERE gitlog_entry_id = ?',
      [input.id],
    );
    for (const commitId of input.commitIds || []) {
      this.database.execute(
        `INSERT OR IGNORE INTO gitlog_entry_commits(
          gitlog_entry_id, commit_id
        ) VALUES (?, ?)`,
        [input.id, commitId],
      );
    }
  }
}
