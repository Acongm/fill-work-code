export type SqlValue = string | number | Uint8Array | null;

export interface Database {
  execute(sql: string, params?: SqlValue[]): void;
  all<T>(sql: string, params?: SqlValue[]): T[];
  get<T>(sql: string, params?: SqlValue[]): T | undefined;
  transaction<T>(fn: () => T): T;
  flush(): Promise<void>;
  close(): Promise<void>;
}
