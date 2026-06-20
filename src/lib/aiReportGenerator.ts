import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AiClient } from './aiClient';
import { WorkLogManager, DailyLog } from './workLogManager';

interface AiDailyResult {
  date: string;
  advice: string[];
  polished: {
    completed: string[];
    plan: string[];
    blockers: string[];
    notes: string;
  };
}

interface AiWeeklyResult {
  weekIndex: number;
  range: string;
  summary: string;
  highlights: string[];
  risks: string[];
  nextPlan: string[];
}

interface AiMonthlyResult {
  summary: string;
  highlights: string[];
  risks: string[];
  improvements: string[];
}

interface AiOutput {
  year: number;
  month: number;
  generatedAt: string;
  daily: Record<string, AiDailyResult>;
  weekly: AiWeeklyResult[];
  monthly: AiMonthlyResult;
}

export class AiReportGenerator {
  private ai: AiClient;
  private workLogManager: WorkLogManager;

  constructor(workLogManager: WorkLogManager) {
    this.ai = new AiClient();
    this.workLogManager = workLogManager;
  }

  public async generateAll(year: number, month: number): Promise<{ jsonPath: string; mdPath: string }> {
    const configError = this.ai.validateConfig();
    if (configError) {
      throw new Error(configError);
    }

    const monthlyLogs = this.workLogManager.getMonthlyLogs(year, month);
    const dailyLogs = this.sanitizeLogs(monthlyLogs.logs || []);
    const weeklyGroups = this.groupLogsByWorkWeek(dailyLogs);

    // 🚀 批量处理日报（按周分组，每周一次请求）
    const dailyResults: Record<string, AiDailyResult> = {};
    console.log(`📦 批量处理 ${weeklyGroups.length} 周的日报数据`);
    
    for (let i = 0; i < weeklyGroups.length; i++) {
      const weekLogs = weeklyGroups[i];
      console.log(`  处理第 ${i + 1} 周: ${weekLogs.length} 天`);
      const batchResults = await this.generateDailyBatch(weekLogs);
      Object.assign(dailyResults, batchResults);
    }

    // 周报和月报保持不变
    const weeklyResults: AiWeeklyResult[] = [];
    for (let i = 0; i < weeklyGroups.length; i++) {
      const weekly = await this.generateWeekly(i + 1, weeklyGroups[i]);
      weeklyResults.push(weekly);
    }

    const monthlyResult = dailyLogs.length > 20
      ? await this.generateMonthlyFromWeekly(year, month, weeklyResults)
      : await this.generateMonthly(year, month, dailyLogs);

    const output: AiOutput = {
      year,
      month,
      generatedAt: new Date().toISOString(),
      daily: dailyResults,
      weekly: weeklyResults,
      monthly: monthlyResult
    };

    const storagePath = this.resolveStoragePath();
    const monthDir = path.join(storagePath, `${year}-${String(month).padStart(2, '0')}`);
    if (!fs.existsSync(monthDir)) {
      fs.mkdirSync(monthDir, { recursive: true });
    }

    const jsonPath = path.join(monthDir, `AI_${year}-${String(month).padStart(2, '0')}.json`);
    const mdPath = path.join(monthDir, 'AI_summary.md');

    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf-8');
    fs.writeFileSync(mdPath, this.buildMarkdown(output), 'utf-8');

    return { jsonPath, mdPath };
  }

  private async generateDaily(log: DailyLog): Promise<AiDailyResult> {
    const prompt = this.buildDailyPrompt(log);
    const taskName = `日报润色 [${log.date}]`;
    const content = await this.ai.chat(
      [
        { role: 'system', content: '你是专业中文写作助手。只输出 JSON，不要输出推理。' },
        { role: 'user', content: prompt }
      ],
      this.ai.getMaxTokensDaily(),
      taskName
    );

    const parsed = this.safeParseJson(content, { advice: [], polished: { completed: [], plan: [], blockers: [], notes: '' } });
    return {
      date: log.date,
      advice: Array.isArray(parsed.advice) ? parsed.advice : [],
      polished: {
        completed: Array.isArray(parsed.polished?.completed) ? parsed.polished.completed : [],
        plan: Array.isArray(parsed.polished?.plan) ? parsed.polished.plan : [],
        blockers: Array.isArray(parsed.polished?.blockers) ? parsed.polished.blockers : [],
        notes: typeof parsed.polished?.notes === 'string' ? parsed.polished.notes : ''
      }
    };
  }

  /**
   * 🚀 批量处理多天日报（一次请求）
   * 将多天的日报合并到一个请求中，大幅减少请求次数
   */
  private async generateDailyBatch(logs: DailyLog[]): Promise<Record<string, AiDailyResult>> {
    if (logs.length === 0) {
      return {};
    }

    const taskName = `批量日报润色 [${logs[0].date} ~ ${logs[logs.length - 1].date}] (${logs.length}天)`;
    const prompt = this.buildDailyBatchPrompt(logs);
    
    const content = await this.ai.chat(
      [
        { 
          role: 'system', 
          content: '你是专业中文写作助手。严格按照 JSON 格式输出，不要输出任何额外内容。' 
        },
        { role: 'user', content: prompt }
      ],
      Math.min(this.ai.getMaxTokensDaily() * 2, 4096), // 批量处理时增加 tokens
      taskName
    );

    const parsed = this.safeParseJson(content, {});
    const results: Record<string, AiDailyResult> = {};

    // 解析批量结果
    logs.forEach(log => {
      const dailyData = parsed[log.date];
      if (dailyData) {
        results[log.date] = {
          date: log.date,
          advice: Array.isArray(dailyData.advice) ? dailyData.advice : [],
          polished: {
            completed: Array.isArray(dailyData.polished?.completed) ? dailyData.polished.completed : log.completed,
            plan: Array.isArray(dailyData.polished?.plan) ? dailyData.polished.plan : log.plan,
            blockers: Array.isArray(dailyData.polished?.blockers) ? dailyData.polished.blockers : log.blockers,
            notes: typeof dailyData.polished?.notes === 'string' ? dailyData.polished.notes : log.notes
          }
        };
      } else {
        // 如果某天解析失败，使用原始数据
        console.warn(`[AI] 解析失败，使用原始数据: ${log.date}`);
        results[log.date] = {
          date: log.date,
          advice: [],
          polished: {
            completed: log.completed || [],
            plan: log.plan || [],
            blockers: log.blockers || [],
            notes: log.notes || ''
          }
        };
      }
    });

    return results;
  }

  private async generateWeekly(weekIndex: number, logs: DailyLog[]): Promise<AiWeeklyResult> {
    const prompt = this.buildWeeklyPrompt(logs);
    const taskName = `周报总结 [Week ${weekIndex}]`;
    const content = await this.ai.chat(
      [
        { role: 'system', content: '你是专业周报总结助手，输出结构化周报。' },
        { role: 'user', content: prompt }
      ],
      this.ai.getMaxTokensWeekly(),
      taskName
    );

    const parsed = this.safeParseJson(content, { summary: '', highlights: [], risks: [], nextPlan: [] });
    const range = logs.length > 0 ? `${logs[0].date} ~ ${logs[logs.length - 1].date}` : '';

    return {
      weekIndex,
      range,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      nextPlan: Array.isArray(parsed.nextPlan) ? parsed.nextPlan : []
    };
  }

  private async generateMonthly(year: number, month: number, logs: DailyLog[]): Promise<AiMonthlyResult> {
    const prompt = this.buildMonthlyPrompt(year, month, logs);
    const taskName = `月报总结 [${year}-${String(month).padStart(2, '0')}]`;
    const content = await this.ai.chat(
      [
        { role: 'system', content: '你是专业月报总结助手，输出结构化月报。' },
        { role: 'user', content: prompt }
      ],
      this.ai.getMaxTokensMonthly(),
      taskName
    );

    const parsed = this.safeParseJson(content, { summary: '', highlights: [], risks: [], improvements: [] });
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements : []
    };
  }

  private async generateMonthlyFromWeekly(year: number, month: number, weekly: AiWeeklyResult[]): Promise<AiMonthlyResult> {
    const prompt = this.buildMonthlyPromptFromWeekly(year, month, weekly);
    const taskName = `月报汇总 [基于周报]`;
    const content = await this.ai.chat(
      [
        { role: 'system', content: '你是专业月报总结助手，输出结构化月报。' },
        { role: 'user', content: prompt }
      ],
      this.ai.getMaxTokensMonthly(),
      taskName
    );

    const parsed = this.safeParseJson(content, { summary: '', highlights: [], risks: [], improvements: [] });
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements : []
    };
  }

  private buildDailyPrompt(log: DailyLog): string {
    return `仅输出 JSON：{ "advice": string[], "polished": { "completed": string[], "plan": string[], "blockers": string[], "notes": string } }\n` +
      `日期: ${log.date}\n` +
      `完成: ${(log.completed || []).join(' | ')}\n` +
      `计划: ${(log.plan || []).join(' | ')}\n` +
      `阻碍: ${(log.blockers || []).join(' | ')}\n` +
      `备注: ${log.notes || ''}`;
  }

  /**
   * 🚀 构建批量日报润色的 Prompt
   */
  private buildDailyBatchPrompt(logs: DailyLog[]): string {
    let prompt = `请对以下 ${logs.length} 天的工作日报进行润色优化。\n\n`;
    prompt += `要求：\n`;
    prompt += `1. 对每天的日报提供润色建议（advice）和润色后的内容（polished）\n`;
    prompt += `2. 润色后的内容应该更专业、简洁、量化\n`;
    prompt += `3. 严格按照以下 JSON 格式输出，不要输出任何其他内容：\n\n`;
    
    prompt += `{\n`;
    prompt += `  "YYYY-MM-DD": {\n`;
    prompt += `    "advice": ["建议1", "建议2"],\n`;
    prompt += `    "polished": {\n`;
    prompt += `      "completed": ["润色后的完成任务1", "润色后的完成任务2"],\n`;
    prompt += `      "plan": ["润色后的计划1"],\n`;
    prompt += `      "blockers": ["润色后的阻碍1"],\n`;
    prompt += `      "notes": "润色后的备注"\n`;
    prompt += `    }\n`;
    prompt += `  }\n`;
    prompt += `}\n\n`;
    
    prompt += `原始数据：\n\n`;
    
    logs.forEach((log, index) => {
      prompt += `${index + 1}. ${log.date}\n`;
      prompt += `   完成: ${(log.completed || []).join(' | ') || '(无)'}\n`;
      prompt += `   计划: ${(log.plan || []).join(' | ') || '(无)'}\n`;
      if ((log.blockers || []).length > 0) {
        prompt += `   阻碍: ${log.blockers.join(' | ')}\n`;
      }
      if (log.notes) {
        prompt += `   备注: ${log.notes}\n`;
      }
      prompt += `\n`;
    });
    
    return prompt;
  }

  private buildWeeklyPrompt(logs: DailyLog[]): string {
    const summary = logs.map(log => {
      return `- ${log.date}\n  完成: ${(log.completed || []).join(' | ')}\n  计划: ${(log.plan || []).join(' | ')}\n  阻碍: ${(log.blockers || []).join(' | ')}\n  备注: ${log.notes || ''}`;
    }).join('\n');

    return `请根据以下一周日报内容输出 JSON 周报，严格只输出 JSON：\n\n` +
      `JSON 结构：{ "summary": string, "highlights": string[], "risks": string[], "nextPlan": string[] }\n\n` +
      `内容：\n${summary}`;
  }

  private buildMonthlyPrompt(year: number, month: number, logs: DailyLog[]): string {
    const summary = logs.map(log => {
      return `- ${log.date} 完成: ${(log.completed || []).join(' | ')}`;
    }).join('\n');

    return `请根据以下当月内容输出 JSON 月报总结，严格只输出 JSON：\n\n` +
      `JSON 结构：{ "summary": string, "highlights": string[], "risks": string[], "improvements": string[] }\n\n` +
      `月份：${year}-${String(month).padStart(2, '0')}\n` +
      `内容：\n${summary}`;
  }

  private buildMonthlyPromptFromWeekly(year: number, month: number, weekly: AiWeeklyResult[]): string {
    const summary = weekly.map(item => {
      return `- Week ${item.weekIndex} (${item.range})\n  总结: ${item.summary}\n  亮点: ${(item.highlights || []).join(' | ')}\n  风险: ${(item.risks || []).join(' | ')}\n  下周: ${(item.nextPlan || []).join(' | ')}`;
    }).join('\n');

    return `请根据以下每周总结输出 JSON 月报总结，严格只输出 JSON：\n\n` +
      `JSON 结构：{ "summary": string, "highlights": string[], "risks": string[], "improvements": string[] }\n\n` +
      `月份：${year}-${String(month).padStart(2, '0')}\n` +
      `内容：\n${summary}`;
  }

  private buildMarkdown(output: AiOutput): string {
    const monthKey = `${output.year}-${String(output.month).padStart(2, '0')}`;
    let text = `# ${monthKey} AI 复盘\n\n`;

    text += `## 日报润色\n\n`;
    for (const date of Object.keys(output.daily).sort()) {
      const daily = output.daily[date];
      text += `### ${date}\n\n`;
      text += `**润色建议**\n`;
      text += daily.advice.length > 0 ? daily.advice.map(t => `- ${t}`).join('\n') : '- (无)';
      text += `\n\n`;
      text += `**润色结果**\n`;
      text += `- 完成: ${daily.polished.completed.join(' | ') || '(空)'}\n`;
      text += `- 计划: ${daily.polished.plan.join(' | ') || '(空)'}\n`;
      text += `- 阻碍: ${daily.polished.blockers.join(' | ') || '(空)'}\n`;
      text += `- 备注: ${daily.polished.notes || '(空)'}\n\n`;
    }

    text += `## 周报总结\n\n`;
    output.weekly.forEach(week => {
      text += `### Week ${week.weekIndex} (${week.range})\n\n`;
      text += `${week.summary}\n\n`;
      text += `**亮点**\n${week.highlights.map(t => `- ${t}`).join('\n') || '- (无)'}\n\n`;
      text += `**风险**\n${week.risks.map(t => `- ${t}`).join('\n') || '- (无)'}\n\n`;
      text += `**下周计划**\n${week.nextPlan.map(t => `- ${t}`).join('\n') || '- (无)'}\n\n`;
    });

    text += `## 月报总结\n\n`;
    text += `${output.monthly.summary}\n\n`;
    text += `**关键成果**\n${output.monthly.highlights.map(t => `- ${t}`).join('\n') || '- (无)'}\n\n`;
    text += `**风险问题**\n${output.monthly.risks.map(t => `- ${t}`).join('\n') || '- (无)'}\n\n`;
    text += `**改进建议**\n${output.monthly.improvements.map(t => `- ${t}`).join('\n') || '- (无)'}\n`;

    return text;
  }

  private resolveStoragePath(): string {
    const config = vscode.workspace.getConfiguration('dailyWorkLog');
    let storagePath = config.get<string>('storagePath') || '~/.work-logs';
    if (storagePath.startsWith('~/')) {
      storagePath = path.join(require('os').homedir(), storagePath.slice(2));
    } else if (storagePath === '~') {
      storagePath = require('os').homedir();
    }
    return storagePath;
  }

  private groupLogsByWorkWeek(logs: DailyLog[]): DailyLog[][] {
    const sorted = [...logs].filter(l => l.date).sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) {
      return [];
    }
    const groups: DailyLog[][] = [];
    let currentGroup: DailyLog[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].date + 'T12:00:00');
      const curr = new Date(sorted[i].date + 'T12:00:00');
      const diff = Math.floor((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
      if (diff === 1) {
        currentGroup.push(sorted[i]);
      } else {
        groups.push(currentGroup);
        currentGroup = [sorted[i]];
      }
    }
    groups.push(currentGroup);
    return groups;
  }

  private safeParseJson(text: string, fallback: any): any {
    try {
      const trimmed = text.trim();
      if (trimmed.startsWith('{')) {
        return JSON.parse(trimmed);
      }
      const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return fallback;
    } catch (e) {
      return fallback;
    }
  }

  private sanitizeLogs(logs: DailyLog[]): DailyLog[] {
    const sanitized = logs
      .filter(log => this.isValidDate(log.date))
      .map(log => ({
        date: log.date,
        completed: Array.isArray(log.completed) ? log.completed.filter(Boolean) : [],
        plan: Array.isArray(log.plan) ? log.plan.filter(Boolean) : [],
        blockers: Array.isArray(log.blockers) ? log.blockers.filter(Boolean) : [],
        notes: typeof log.notes === 'string' ? log.notes.trim() : ''
      }))
      .filter(log => log.completed.length > 0 || log.plan.length > 0 || log.blockers.length > 0 || log.notes.length > 0);

    const byDate: Record<string, DailyLog> = {};
    sanitized.forEach(log => {
      byDate[log.date] = log;
    });

    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }

  private isValidDate(value: string): boolean {
    if (!value) {
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const date = new Date(value + 'T00:00:00');
    return !Number.isNaN(date.getTime());
  }
}
