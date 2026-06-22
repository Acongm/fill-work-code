import * as vscode from 'vscode';
import * as path from 'path';
import type { DailyLog } from '../../lib/workLogManager';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ExcelJS = require('exceljs');
import type { HostPanelDeps } from './types';

function parseTimesheetSheet(sheet: any): DailyLog[] {
  const items: Record<string, DailyLog> = {};
  const endRow = sheet.actualRowCount || sheet.rowCount || 2000;
  const { startRow, dateCol, detailCol } = detectColumns(sheet, endRow);
  console.log(`[xlsx-import] detect startRow=${startRow} dateCol=${dateCol} detailCol=${detailCol} endRow=${endRow}`);

  for (let i = startRow; i <= endRow; i++) {
    const row = sheet.getRow(i);
    const dateValue = row.getCell(dateCol).value;
    if (i === startRow || i === startRow + 1) {
      console.log(`[xlsx-import] row ${i} raw date=`, dateValue);
      console.log(`[xlsx-import] row ${i} raw detail=`, row.getCell(detailCol).value);
    }
    const dateStr = parseDateCell(dateValue);
    if (!dateStr) {
      continue;
    }

    const detailValue = row.getCell(detailCol).value;
    const detailText = cellToText(detailValue);
    if (detailText.includes('Detail Description') || detailText.includes('Working Hours')) {
      continue;
    }
    const tasks = splitTasks(detailText);

    if (!items[dateStr]) {
      items[dateStr] = {
        date: dateStr,
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

    if (tasks.length > 0) {
      items[dateStr].completed.push(...tasks);
    }
  }

  return Object.values(items).sort((a, b) => a.date.localeCompare(b.date));
}

function detectColumns(sheet: any, endRow: number): { startRow: number; dateCol: number; detailCol: number } {
  const maxRow = Math.min(endRow, 15);
  let headerRow = 5;
  let dateCol = 2;
  let detailCol = 4;

  for (let i = 1; i <= maxRow; i++) {
    const row = sheet.getRow(i);
    const cells = row.values || [];
    let foundDateCol: number | null = null;
    let foundDetailCol: number | null = null;

    for (let col = 1; col < cells.length; col++) {
      const text = cellToText(row.getCell(col).value).toLowerCase();
      if (!foundDateCol && (text.includes('date') || text.includes('日期'))) {
        foundDateCol = col;
      }
      if (!foundDetailCol && (text.includes('detail') || text.includes('description') || text.includes('内容') || text.includes('工作') || text.includes('任务'))) {
        foundDetailCol = col;
      }
    }

    if (foundDateCol) {
      headerRow = i;
      dateCol = foundDateCol;
      if (foundDetailCol) {
        detailCol = foundDetailCol;
      }
      break;
    }
  }

  return { startRow: headerRow + 1, dateCol, detailCol };
}

function parseDateCell(value: any): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return formatDate(value);
  }

  if (typeof value === 'number') {
    if (value >= 19000101 && value <= 21001231) {
      const raw = String(Math.trunc(value));
      if (raw.length === 8) {
        return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      }
    }

    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      return formatDate(date);
    }
  }

  if (typeof value === 'object') {
    if (value.result) {
      return parseDateCell(value.result);
    }
    if (value.text) {
      return parseDateCell(value.text);
    }
    if (value.richText) {
      return parseDateCell(cellToText(value));
    }
  }

  const text = cellToText(value);
  if (!text) {
    return null;
  }

  const cleaned = text.trim();
  if (/^\d{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
  }
  if (/^\d{8}\.\d+$/.test(cleaned)) {
    const raw = cleaned.split('.')[0];
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleaned)) {
    const [y, m, d] = cleaned.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}[/.]\d{1,2}[/.]\d{1,2}$/.test(cleaned)) {
    const parts = cleaned.replace(/\./g, '/').split('/');
    const [y, m, d] = parts;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const parsed = Date.parse(cleaned);
  if (!Number.isNaN(parsed)) {
    return formatDate(new Date(parsed));
  }

  return null;
}

function cellToText(value: any): string {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (value.text) {
    return String(value.text);
  }
  if (Array.isArray(value.richText)) {
    return value.richText.map((t: any) => t.text || '').join('');
  }
  return String(value);
}

function splitTasks(text: string): string[] {
  if (!text || !text.trim()) {
    return [];
  }

  const normalized = text.replace(/\r/g, '\n');
  const parts = normalized.split(/\n|\s*&\s*|\s*\|\s*|；|;|、/g);
  const tasks = parts.map(p => p.trim()).filter(Boolean);
  return tasks.length > 0 ? tasks : [text.trim()];
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function selectXlsxImport(
  deps: HostPanelDeps,
  year: number,
  month: number,
): Promise<void> {
  const selections = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Excel: ['xlsx'] },
  });

  if (!selections || selections.length === 0) {
    return;
  }

  const filePath = selections[0].fsPath;
  console.log(`[xlsx-import] selected: ${filePath}`);
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    console.log(`[xlsx-import] sheet: ${sheet?.name || 'unknown'} rows=${sheet?.rowCount} actualRows=${sheet?.actualRowCount}`);

    const allParsed = parseTimesheetSheet(sheet);
    console.log(`[xlsx-import] parsed total=${allParsed.length}`);
    if (allParsed.length === 0) {
      vscode.window.showWarningMessage('未在该文件中找到可导入的日期记录');
      return;
    }

    const parsed = allParsed.filter(item => {
      const [y, m] = item.date.split('-').map(Number);
      return y === year && m === month;
    });

    if (parsed.length === 0) {
      const choice = await vscode.window.showWarningMessage(
        `未匹配到 ${year}-${String(month).padStart(2, '0')} 的记录，是否导入全部日期？`,
        { modal: true },
        '导入全部',
        '取消',
      );
      if (choice !== '导入全部') {
        return;
      }
    }

    const finalItems = parsed.length > 0 ? parsed : allParsed;
    console.log(`[xlsx-import] final items=${finalItems.length}`);

    deps.state.pendingImportItems = finalItems;
    deps.postToWebview({
      command: 'importPreview',
      source: path.basename(filePath),
      year,
      month,
      items: finalItems.map(item => ({
        date: item.date,
        completed: item.completed,
        exists: deps.workLogManager.getDailyLog(new Date(item.date + 'T12:00:00')) !== null,
      })),
    });
  } catch (e) {
    console.error('[xlsx-import] failed:', e);
    vscode.window.showErrorMessage(`导入失败: ${e}`);
  }
}

export async function confirmImport(
  deps: HostPanelDeps,
  year: number,
  month: number,
  dates: string[],
): Promise<void> {
  if (!deps.state.pendingImportItems || deps.state.pendingImportItems.length === 0) {
    vscode.window.showWarningMessage('没有可导入的数据');
    return;
  }

  const selectedSet = new Set(dates);
  const items = dates.length > 0
    ? deps.state.pendingImportItems.filter(item => selectedSet.has(item.date))
    : deps.state.pendingImportItems;

  if (items.length === 0) {
    vscode.window.showWarningMessage('未选择任何要导入的日期');
    return;
  }

  const existing = items.filter(item => {
    return deps.workLogManager.getDailyLog(new Date(item.date + 'T12:00:00')) !== null;
  });

  let overwrite = false;
  if (existing.length > 0) {
    const choice = await vscode.window.showWarningMessage(
      `检测到 ${existing.length} 条已存在日志，如何处理？`,
      { modal: true },
      '覆盖全部',
      '跳过已存在',
      '取消',
    );
    if (choice === '覆盖全部') {
      overwrite = true;
    } else if (choice === '跳过已存在') {
      overwrite = false;
    } else {
      return;
    }
  }

  let imported = 0;
  let skipped = 0;
  for (const item of items) {
    const date = new Date(item.date + 'T12:00:00');
    const exists = deps.workLogManager.getDailyLog(date) !== null;
    if (exists && !overwrite) {
      skipped++;
      continue;
    }
    deps.workLogManager.saveDailyLog(date, item);
    imported++;
  }

  deps.state.pendingImportItems = null;

  deps.postToWebview({
    command: 'importResult',
    year,
    month,
    imported,
    skipped,
  });
}
