import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { DailyLog, MonthlyLog } from '../../shared/types/dailyLog';
import { resolveRuntimePaths } from '../../settings/utils/pathUtils';

export type { DailyLog, MonthlyLog } from '../../shared/types/dailyLog';

export class WorkLogManager {
  private storageDir: string;
  private readonly dateWriteQueues = new Map<string, Promise<void>>();

  constructor(storageDir: string) {
    this.storageDir = resolveRuntimePaths(storageDir).root;
    this.ensureStorageDir();
  }

  getStorageDir(): string {
    return this.storageDir;
  }

  private ensureStorageDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private getYearMonthDir(date: Date): string {
    const year = date.getFullYear();
    const dirPath = resolveRuntimePaths(this.storageDir).month(
      year,
      date.getMonth() + 1,
    );
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
  }

  private getMonthDir(year: number, month: number): string {
    const dirPath = resolveRuntimePaths(this.storageDir).month(year, month);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
  }

  private getMonthSummaryPath(year: number, month: number): string {
    const dirPath = this.getMonthDir(year, month);
    return path.join(dirPath, '_summary.md');
  }

  private getDateFilePath(date: Date): string {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const dir = this.getYearMonthDir(date);
    return path.join(dir, `${dateStr}.json`);
  }

  private getDateFilePathFromString(date: string): string {
    const [year, month] = date.split('-').map(Number);
    return path.join(this.getMonthDir(year, month), `${date}.json`);
  }

  private normalizeDailyLog(log: Partial<DailyLog>): DailyLog {
    return {
      date: typeof log.date === 'string' ? log.date : '',
      completed: Array.isArray(log.completed) ? log.completed.filter(Boolean) : [],
      plan: Array.isArray(log.plan) ? log.plan.filter(Boolean) : [],
      blockers: Array.isArray(log.blockers) ? log.blockers.filter(Boolean) : [],
      notes: typeof log.notes === 'string' ? log.notes : '',
      gitlog: Array.isArray(log.gitlog) ? log.gitlog.filter(Boolean) : [],
      ailog: Array.isArray(log.ailog) ? log.ailog.filter(Boolean) : [],
      gitCommit: Array.isArray(log.gitCommit) ? log.gitCommit.filter(Boolean) : [],
      origin_url: Array.isArray(log.origin_url) ? log.origin_url.filter(Boolean) : [],
      projectLinks: Array.isArray(log.projectLinks)
        ? log.projectLinks.filter(
            (link) =>
              link &&
              typeof link.content === 'string' &&
              (link.assignment === 'project' ||
                link.assignment === 'unassigned'),
          )
        : [],
    };
  }

  private readRawDailyLog(date: string): Record<string, unknown> {
    const filePath = this.getDateFilePathFromString(date);
    if (!fs.existsSync(filePath)) {
      return this.normalizeDailyLog({ date }) as unknown as Record<
        string,
        unknown
      >;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Invalid daily JSON object: ${filePath}`);
    }
    return parsed as Record<string, unknown>;
  }

  private async writeRawDailyLog(
    date: string,
    log: Record<string, unknown>,
  ): Promise<void> {
    const filePath = this.getDateFilePathFromString(date);
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(
      temporaryPath,
      `${JSON.stringify(log, null, 2)}\n`,
      'utf-8',
    );
    await fs.promises.rename(temporaryPath, filePath);
    const [year, month, day] = date.split('-').map(Number);
    this.updateMonthSummaryCache(new Date(year, month - 1, day, 12));
  }

  private enqueueDateWrite(
    date: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.dateWriteQueues.get(date) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.dateWriteQueues.set(date, current);
    return current.finally(() => {
      if (this.dateWriteQueues.get(date) === current) {
        this.dateWriteQueues.delete(date);
      }
    });
  }

  public saveUserFields(date: string, log: DailyLog): Promise<void> {
    return this.enqueueDateWrite(date, async () => {
      const existing = this.readRawDailyLog(date);
      const normalized = this.normalizeDailyLog({ ...log, date });
      const next: Record<string, unknown> = {
        ...existing,
        date,
        completed: normalized.completed,
        plan: normalized.plan,
        blockers: normalized.blockers,
        notes: normalized.notes,
      };
      if (log.projectLinks !== undefined) {
        next.projectLinks = normalized.projectLinks;
      }
      await this.writeRawDailyLog(date, next);
    });
  }

  public patchGeneratedFields(
    date: string,
    group: 'git',
    fields: Pick<DailyLog, 'gitlog' | 'gitCommit' | 'origin_url'>,
  ): Promise<void>;
  public patchGeneratedFields(
    date: string,
    group: 'ai',
    fields: Pick<DailyLog, 'ailog'>,
  ): Promise<void>;
  public patchGeneratedFields(
    date: string,
    group: 'git' | 'ai',
    fields:
      | Pick<DailyLog, 'gitlog' | 'gitCommit' | 'origin_url'>
      | Pick<DailyLog, 'ailog'>,
  ): Promise<void> {
    return this.enqueueDateWrite(date, async () => {
      const existing = this.readRawDailyLog(date);
      let next: Record<string, unknown>;
      if (group === 'git') {
        const gitFields = fields as Pick<
          DailyLog,
          'gitlog' | 'gitCommit' | 'origin_url'
        >;
        next = {
          ...existing,
          date,
          gitlog: Array.isArray(gitFields.gitlog)
            ? gitFields.gitlog.filter(Boolean)
            : [],
          gitCommit: Array.isArray(gitFields.gitCommit)
            ? gitFields.gitCommit.filter(Boolean)
            : [],
          origin_url: Array.isArray(gitFields.origin_url)
            ? gitFields.origin_url.filter(Boolean)
            : [],
        };
      } else {
        const aiFields = fields as Pick<DailyLog, 'ailog'>;
        next = {
          ...existing,
          date,
          ailog: Array.isArray(aiFields.ailog)
            ? aiFields.ailog.filter(Boolean)
            : [],
        };
      }
      await this.writeRawDailyLog(date, next);
    });
  }

  // 获取指定日期的日志
  public getDailyLog(date: Date): DailyLog | null {
    const filePath = this.getDateFilePath(date);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.normalizeDailyLog(JSON.parse(content));
    } catch (e) {
      console.error(`Failed to read log from ${filePath}:`, e);
      return null;
    }
  }

  // 保存日志
  public saveDailyLog(date: Date, log: DailyLog): void {
    const filePath = this.getDateFilePath(date);
    try {
      fs.writeFileSync(filePath, JSON.stringify(this.normalizeDailyLog(log), null, 2), 'utf-8');
      this.updateMonthSummaryCache(date);
    } catch (e) {
      console.error(`Failed to save log to ${filePath}:`, e);
      throw e;
    }
  }

  // 获取当月所有日志
  public getMonthlyLogs(year: number, month: number): MonthlyLog {
    const dirPath = this.getMonthDir(year, month);

    const logs: DailyLog[] = [];
    if (fs.existsSync(dirPath)) {
      const files = fs
        .readdirSync(dirPath)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
      files.forEach(file => {
        try {
          const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
          logs.push(this.normalizeDailyLog(JSON.parse(content)));
        } catch (e) {
          console.error(`Failed to read ${file}:`, e);
        }
      });
    }

    // 按日期排序
    logs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return { year, month, logs };
  }

  public getAllDailyLogs(): DailyLog[] {
    if (!fs.existsSync(this.storageDir)) {
      return [];
    }
    return fs
      .readdirSync(this.storageDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name),
      )
      .flatMap((entry) => {
        const [year, month] = entry.name.split('-').map(Number);
        return this.getMonthlyLogs(year, month).logs;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // 获取今天的日志（如果不存在则返回默认值）
  public getTodayLog(): DailyLog {
    const today = new Date();
    const existingLog = this.getDailyLog(today);
    if (existingLog) {
      return existingLog;
    }
    return {
      date: today.toISOString().split('T')[0],
      completed: [],
      plan: [],
      blockers: [],
      notes: '',
      gitlog: [],
      ailog: [],
      gitCommit: [],
      origin_url: []
    };
  }

  // 获取昨天的日志
  public getYesterdayLog(): DailyLog | null {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return this.getDailyLog(yesterday);
  }

  // 生成月度总结用于 AI 分析
  public getMonthSummary(year: number, month: number): string {
    const monthly = this.getMonthlyLogs(year, month);
    let summary = `# ${year}年${month}月工作日报\n\n`;

    monthly.logs
      ?.filter(t => t.date)
      .forEach(log => {
        const completed = Array.isArray(log.completed) ? log.completed : [];
        const plan = Array.isArray(log.plan) ? log.plan : [];
        const blockers = Array.isArray(log.blockers) ? log.blockers : [];
        const notes = typeof log.notes === 'string' ? log.notes : '';

        summary += `----\n ## ${log.date}\n`;
        summary += `**完成:**\n${completed.map(t => `- ${t}`).join('\n')}\n\n`;
        summary += `**计划:**\n${plan.map(t => `- ${t}`).join('\n')}\n\n`;
        if (blockers.length > 0) {
          summary += `**阻碍/问题:**\n${blockers.map(t => `- ${t}`).join('\n')}\n\n`;
        }
        if (notes) {
          summary += `**备注:** ${notes}\n\n`;
        }
      });

    return summary;
  }

  public getMonthSummaryCached(year: number, month: number): string {
    const summaryPath = this.getMonthSummaryPath(year, month);
    if (fs.existsSync(summaryPath)) {
      try {
        return fs.readFileSync(summaryPath, 'utf-8');
      } catch (e) {
        console.error(`Failed to read summary cache from ${summaryPath}:`, e);
      }
    }

    const summary = this.getMonthSummary(year, month);
    try {
      fs.writeFileSync(summaryPath, summary, 'utf-8');
    } catch (e) {
      console.error(`Failed to write summary cache to ${summaryPath}:`, e);
    }
    return summary;
  }

  public clearMonthSummaryCache(year: number, month: number): void {
    const summaryPath = this.getMonthSummaryPath(year, month);
    if (fs.existsSync(summaryPath)) {
      try {
        fs.unlinkSync(summaryPath);
      } catch (e) {
        console.error(`Failed to delete summary cache at ${summaryPath}:`, e);
      }
    }
  }

  private updateMonthSummaryCache(date: Date): void {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const summary = this.getMonthSummary(year, month);
    const summaryPath = this.getMonthSummaryPath(year, month);
    try {
      fs.writeFileSync(summaryPath, summary, 'utf-8');
    } catch (e) {
      console.error(`Failed to update summary cache at ${summaryPath}:`, e);
    }
  }
}
