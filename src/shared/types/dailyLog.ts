export interface DailyLog {
  date: string;
  completed: string[];
  plan: string[];
  blockers: string[];
  notes: string;
  gitlog?: string[];
  ailog?: string[];
  gitCommit?: string[];
  origin_url?: string[];
}

export interface MonthlyLog {
  year: number;
  month: number;
  logs: DailyLog[];
}

export function emptyDailyLog(date: string): DailyLog {
  return {
    date,
    completed: [],
    plan: [],
    blockers: [],
    notes: '',
    gitlog: [],
    ailog: [],
    gitCommit: [],
    origin_url: [],
  };
}
