import type { FillScope } from './types/fillPreview';

export interface FillDateRange {
  start: string;
  end: string;
}

export interface CollectRequest {
  scope: FillScope;
  anchorDate: string;
  rangeStart?: string;
  rangeEnd?: string;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function normalizeCustomRange(start: string, end: string): FillDateRange {
  if (start <= end) {
    return { start, end };
  }
  return { start: end, end: start };
}

export function resolveCustomRange(request: CollectRequest): FillDateRange | undefined {
  if (request.scope !== 'custom' || !request.rangeStart || !request.rangeEnd) {
    return undefined;
  }
  return normalizeCustomRange(request.rangeStart, request.rangeEnd);
}

/** 本周：上周六 ~ min(本周五, 锚点日)；单日：仅锚点日；自定义：起止区间内逐日 */
export function resolveFillDates(
  scope: FillScope,
  anchorDate: string,
  customRange?: FillDateRange,
): string[] {
  if (scope === 'day') {
    return [anchorDate];
  }
  if (scope === 'custom' && customRange) {
    const dates: string[] = [];
    let cursor = customRange.start;
    while (cursor <= customRange.end) {
      dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return dates;
  }
  const day = new Date(`${anchorDate}T12:00:00`).getDay();
  const daysBackToSat = (day + 1) % 7;
  const sat = addDays(anchorDate, -daysBackToSat);
  const fri = addDays(sat, 6);
  const end = anchorDate <= fri ? anchorDate : fri;
  const dates: string[] = [];
  let cursor = sat;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function resolveFillDateRange(
  scope: FillScope,
  anchorDate: string,
  customRange?: FillDateRange,
): { startDate: string; endDate: string; dates: string[] } {
  const dates = resolveFillDates(scope, anchorDate, customRange);
  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    dates,
  };
}

export function resolveCollectDates(request: CollectRequest): string[] {
  return resolveFillDates(
    request.scope,
    request.anchorDate,
    resolveCustomRange(request),
  );
}

/** 本地日期 YYYY-MM-DD */
export function localTodayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** 采集日期全部严格早于今天（纯历史范围） */
export function isHistoricalCollectRange(dates: string[]): boolean {
  if (dates.length === 0) {
    return false;
  }
  const today = localTodayStr();
  return dates.every((date) => date < today);
}

/** 工具栏/标题锚点文案 */
export function formatFillAnchorLabel(
  scope: FillScope,
  anchorDate: string,
  customRange?: FillDateRange,
): string {
  if (scope === 'day') {
    return anchorDate;
  }
  if (scope === 'custom' && customRange) {
    return customRange.start === customRange.end
      ? customRange.start
      : `${customRange.start} ~ ${customRange.end}`;
  }
  const { startDate, endDate } = resolveFillDateRange(scope, anchorDate);
  return startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
}

export function formatFillScopeAnchorTitle(request: CollectRequest): string {
  const scopeLabel =
    request.scope === 'day'
      ? '单日'
      : request.scope === 'workWeek'
        ? '本周'
        : '自定义';
  return `${scopeLabel} · ${formatFillAnchorLabel(
    request.scope,
    request.anchorDate,
    resolveCustomRange(request),
  )}`;
}

export function formatFillAnchorHint(request: CollectRequest): string {
  const custom = resolveCustomRange(request);
  if (request.scope === 'day') {
    return `单日：仅采集当前浏览日 ${request.anchorDate}`;
  }
  if (request.scope === 'custom' && custom) {
    return `自定义：采集 ${custom.start} 至 ${custom.end}（共 ${resolveFillDates('custom', request.anchorDate, custom).length} 天）`;
  }
  const label = formatFillAnchorLabel(request.scope, request.anchorDate);
  return `本周：${label}（以当前浏览日为锚点，上周六至本周五，未到周五则截至浏览日）`;
}

export function collectRequestFromPreview(preview: {
  scope: FillScope;
  anchorDate: string;
  rangeStart?: string;
  rangeEnd?: string;
}): CollectRequest {
  return {
    scope: preview.scope,
    anchorDate: preview.anchorDate,
    rangeStart: preview.rangeStart,
    rangeEnd: preview.rangeEnd,
  };
}
