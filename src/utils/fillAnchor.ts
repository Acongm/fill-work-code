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
  forceRescan?: boolean;
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

/** 本周：上周六 ~ 本周五（固定 7 天）；单日：仅锚点日；自定义：起止区间内逐日 */
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
  const dates: string[] = [];
  let cursor = sat;
  while (cursor <= fri) {
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
  return `本周：${label}（周六至周五，共 7 天）`;
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

export type CollectView = FillScope;

export interface CollectViewState {
  view: CollectView;
  logDate: string;
  customStart: string;
  customEnd: string;
}

export function collectViewStateFromParts(
  view: CollectView,
  logDate: string,
  customStart: string,
  customEnd: string,
): CollectViewState {
  return { view, logDate, customStart, customEnd };
}

/** Resolve effective date range for current collect view state. */
export function resolveEffectiveRange(state: CollectViewState): FillDateRange {
  if (state.view === 'custom') {
    return normalizeCustomRange(state.customStart, state.customEnd);
  }
  const range = resolveFillDateRange(state.view, state.logDate);
  return { start: range.startDate, end: range.endDate };
}

/**
 * When switching day / workWeek / custom, adjust logDate and custom range.
 * Custom inherits the previous mode's resolved range.
 */
export function transitionCollectView(
  state: CollectViewState,
  nextView: CollectView,
): CollectViewState {
  const effective = resolveEffectiveRange(state);
  if (nextView === 'custom') {
    return {
      view: 'custom',
      logDate: effective.start,
      customStart: effective.start,
      customEnd: effective.end,
    };
  }
  const endDate = effective.end;
  if (nextView === 'day') {
    return {
      view: 'day',
      logDate: endDate,
      customStart: state.customStart,
      customEnd: state.customEnd,
    };
  }
  return {
    view: 'workWeek',
    logDate: endDate,
    customStart: state.customStart,
    customEnd: state.customEnd,
  };
}

/** 将采集请求收窄为指定日期列表（用于增量 Git 扫描） */
export function narrowCollectRequestToDates(
  request: CollectRequest,
  dates: string[],
): CollectRequest {
  if (dates.length === 0) {
    return request;
  }
  const sorted = [...dates].sort();
  return {
    ...request,
    scope: 'custom',
    anchorDate: sorted[0],
    rangeStart: sorted[0],
    rangeEnd: sorted[sorted.length - 1],
  };
}
