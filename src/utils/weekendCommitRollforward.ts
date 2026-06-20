import type { FillPreviewDay } from './types/fillPreview';

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function isWeekendDate(dateStr: string): boolean {
  const day = new Date(`${dateStr}T12:00:00`).getDay();
  return day === 0 || day === 6;
}

/** 周末提交在 AI 润色时归入下一个周一 */
export function mondayBucketForWeekend(dateStr: string): string {
  const day = new Date(`${dateStr}T12:00:00`).getDay();
  if (day === 0) {
    return addDays(dateStr, 1);
  }
  if (day === 6) {
    return addDays(dateStr, 2);
  }
  return dateStr;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function mergePreviewDays(target: FillPreviewDay, extra: FillPreviewDay): FillPreviewDay {
  return {
    ...target,
    gitlog: uniqueStrings([...target.gitlog, ...extra.gitlog]),
    gitCommit: uniqueStrings([...target.gitCommit, ...extra.gitCommit]),
    originUrl: uniqueStrings([...target.originUrl, ...extra.originUrl]),
    warnings: uniqueStrings([...target.warnings, ...extra.warnings]),
  };
}

/**
 * AI 润色输入：工作日保留当日；周末并入下一周一；周一额外合并上周六日证据。
 */
export function buildAiPolishDayInputs(days: FillPreviewDay[]): FillPreviewDay[] {
  const byDate = new Map(days.map((day) => [day.date, { ...day }]));

  for (const day of days) {
    if (!isWeekendDate(day.date)) {
      continue;
    }
    const monday = mondayBucketForWeekend(day.date);
    const mondayDay = byDate.get(monday);
    if (!mondayDay) {
      continue;
    }
    byDate.set(monday, mergePreviewDays(mondayDay, day));
  }

  const polishTargets: FillPreviewDay[] = [];
  for (const day of days) {
    if (isWeekendDate(day.date)) {
      const monday = mondayBucketForWeekend(day.date);
      if (days.some((d) => d.date === monday)) {
        continue;
      }
      polishTargets.push({
        ...(byDate.get(day.date) || day),
        warnings: uniqueStrings([
          ...day.warnings,
          `周末 ${day.date} 的提交在 AI 润色时按周一 ${monday} 归类`,
        ]),
      });
      continue;
    }

    const merged = byDate.get(day.date) || day;
    const mergedWeekend = merged.gitlog.length > day.gitlog.length;
    polishTargets.push({
      ...merged,
      warnings: uniqueStrings([
        ...merged.warnings,
        ...(mergedWeekend ? [`已并入周末提交到 ${day.date} 的 AI 润色输入`] : []),
      ]),
    });
  }

  return polishTargets;
}

/** 将周末日的 AILog 候选写入对应周一 */
export function applyWeekendAilogRollforward(
  days: FillPreviewDay[],
): FillPreviewDay[] {
  const byDate = new Map(days.map((day) => [day.date, { ...day }]));

  for (const day of days) {
    if (!isWeekendDate(day.date) || day.ailogDraft.length === 0) {
      continue;
    }
    const monday = mondayBucketForWeekend(day.date);
    const mondayDay = byDate.get(monday);
    if (!mondayDay) {
      continue;
    }
    byDate.set(monday, {
      ...mondayDay,
      ailogDraft: uniqueStrings([...mondayDay.ailogDraft, ...day.ailogDraft]),
      warnings: uniqueStrings([
        ...mondayDay.warnings,
        `已合并 ${day.date}（周末）AILog 到 ${monday}`,
      ]),
    });
    byDate.set(day.date, {
      ...day,
      ailogDraft: [],
      warnings: uniqueStrings([
        ...day.warnings,
        `周末 AILog 已归入 ${monday}`,
      ]),
    });
  }

  return days.map((day) => byDate.get(day.date) || day);
}
