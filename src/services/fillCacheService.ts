import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { PluginSettings } from '../features/settings/pluginSettings';
import type { FillCacheFile, FillPreview, FillPreviewDay, FillScope } from '../utils/types/fillPreview';

const CACHE_DIR = '.fill-cache';

export interface FillCacheSearchConfig {
  searchRoots: string[];
  authorAliases: string[];
  originFilters: string[];
}

export function buildFillCacheSearchConfig(
  settings: PluginSettings,
): FillCacheSearchConfig {
  return {
    searchRoots: [...settings.searchRoots].map((s) => s.trim()).filter(Boolean).sort(),
    authorAliases: [...settings.authorAliases].map((s) => s.trim()).filter(Boolean).sort(),
    originFilters: [...settings.originFilters].map((s) => s.trim()).filter(Boolean).sort(),
  };
}

function searchConfigHash(config: FillCacheSearchConfig): string {
  const payload = JSON.stringify(config);
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 8);
}

export function fillCacheConfigHash(config: FillCacheSearchConfig): string {
  return searchConfigHash(config);
}

export function monthKeysForDates(dates: string[]): string[] {
  return [...new Set(dates.map((date) => date.slice(0, 7)))];
}

export function previewDateRange(preview: FillPreview): { start: string; end: string } {
  const dates =
    preview.dates.length > 0
      ? preview.dates
      : preview.days.map((day) => day.date);
  if (dates.length === 0) {
    return { start: preview.anchorDate, end: preview.anchorDate };
  }
  const sorted = [...dates].sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

export class FillCacheService {
  constructor(private readonly storagePath: string) {}

  cacheFileName(
    scope: FillScope,
    anchorDate: string,
    rangeEnd?: string,
    searchConfig?: FillCacheSearchConfig,
  ): string {
    const base =
      scope === 'custom' && rangeEnd
        ? `fill-${anchorDate}_${rangeEnd}-custom`
        : `fill-${anchorDate}-${scope}`;
    if (!searchConfig) {
      return `${base}.json`;
    }
    return `${base}-${searchConfigHash(searchConfig)}.json`;
  }

  rangeCacheFileName(
    startDate: string,
    endDate: string,
    searchConfig?: FillCacheSearchConfig,
  ): string {
    const base = `fill-range-${startDate}_${endDate}`;
    if (!searchConfig) {
      return `${base}.json`;
    }
    return `${base}-${searchConfigHash(searchConfig)}.json`;
  }

  cachePath(
    monthKey: string,
    preview: FillPreview,
    searchConfig?: FillCacheSearchConfig,
  ): string {
    return path.join(
      this.storagePath,
      monthKey,
      CACHE_DIR,
      this.cacheFileName(
        preview.scope,
        preview.anchorDate,
        preview.rangeEnd,
        searchConfig,
      ),
    );
  }

  rangeCachePath(
    monthKey: string,
    startDate: string,
    endDate: string,
    searchConfig?: FillCacheSearchConfig,
  ): string {
    return path.join(
      this.storagePath,
      monthKey,
      CACHE_DIR,
      this.rangeCacheFileName(startDate, endDate, searchConfig),
    );
  }

  save(
    monthKey: string,
    preview: FillPreview,
    searchConfig?: FillCacheSearchConfig,
  ): string {
    const monthKeys = monthKeysForDates(
      preview.dates.length > 0
        ? preview.dates
        : preview.days.map((day) => day.date),
    );
    let lastPath = '';
    for (const key of monthKeys.length > 0 ? monthKeys : [monthKey]) {
      lastPath = this._writeCache(key, preview, searchConfig);
    }
    return lastPath;
  }

  private _writeCache(
    monthKey: string,
    preview: FillPreview,
    searchConfig?: FillCacheSearchConfig,
  ): string {
    const filePath = this.cachePath(monthKey, preview, searchConfig);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const cache: FillCacheFile = {
      scope: preview.scope,
      anchorDate: preview.anchorDate,
      rangeStart: preview.rangeStart,
      rangeEnd: preview.rangeEnd,
      updatedAt: new Date().toISOString(),
      days: preview.days,
      collectedAt: preview.collectedAt,
      error: preview.error,
    };
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf-8');

    const { start, end } = previewDateRange(preview);
    if (start !== end || preview.days.length > 1) {
      const rangePath = this.rangeCachePath(monthKey, start, end, searchConfig);
      fs.writeFileSync(rangePath, JSON.stringify(cache, null, 2), 'utf-8');
    }
    return filePath;
  }

  load(
    monthKey: string,
    preview: FillPreview,
    searchConfig?: FillCacheSearchConfig,
  ): FillPreview | null {
    if (searchConfig) {
      const scoped = this._readCacheFile(
        this.cachePath(monthKey, preview, searchConfig),
      );
      if (scoped) {
        return scoped;
      }
      return this._readCacheFile(this.cachePath(monthKey, preview));
    }
    return this._readCacheFile(this.cachePath(monthKey, preview));
  }

  loadByDateRange(
    monthKeys: string[],
    startDate: string,
    endDate: string,
    searchConfig?: FillCacheSearchConfig,
  ): FillPreview | null {
    for (const monthKey of monthKeys) {
      const rangePath = this.rangeCachePath(
        monthKey,
        startDate,
        endDate,
        searchConfig,
      );
      const ranged = this._readCacheFile(rangePath);
      if (ranged) {
        return ranged;
      }
      const rangedLegacy = this._readCacheFile(
        path.join(
          this.storagePath,
          monthKey,
          CACHE_DIR,
          this.rangeCacheFileName(startDate, endDate),
        ),
      );
      if (rangedLegacy) {
        return rangedLegacy;
      }
    }
    return null;
  }

  assembleForDates(
    monthKeys: string[],
    dates: string[],
    searchConfig?: FillCacheSearchConfig,
  ): FillPreview | null {
    const wanted = new Set(dates);
    const dayByDate = new Map<string, FillPreviewDay>();
    let template: FillPreview | null = null;
    const hashSuffix = searchConfig
      ? `-${searchConfigHash(searchConfig)}.json`
      : '.json';

    for (const monthKey of monthKeys) {
      const cacheDir = path.join(this.storagePath, monthKey, CACHE_DIR);
      if (!fs.existsSync(cacheDir)) {
        continue;
      }
      for (const file of fs.readdirSync(cacheDir)) {
        if (!file.endsWith('.json')) {
          continue;
        }
        if (searchConfig && !file.endsWith(hashSuffix)) {
          continue;
        }
        const cached = this._readCacheFile(path.join(cacheDir, file));
        if (!cached) {
          continue;
        }
        template = template ?? cached;
        for (const day of cached.days) {
          if (wanted.has(day.date) && !dayByDate.has(day.date)) {
            dayByDate.set(day.date, day);
          }
        }
      }
    }

    if (dayByDate.size === 0 || !template) {
      return null;
    }

    const covered = dates.filter((date) => dayByDate.has(date));
    if (covered.length === 0) {
      return null;
    }

    return {
      scope: template.scope,
      anchorDate: template.anchorDate,
      rangeStart: dates[0],
      rangeEnd: dates[dates.length - 1],
      dates,
      days: dates.map(
        (date) =>
          dayByDate.get(date) ?? {
            date,
            completed: [],
            gitlog: [],
            gitCommit: [],
            originUrl: [],
            ailogDraft: [],
            warnings: [],
          },
      ),
      collectedAt: template.collectedAt,
    };
  }

  remove(
    monthKey: string,
    preview: FillPreview,
    searchConfig?: FillCacheSearchConfig,
  ): void {
    const filePath = this.cachePath(monthKey, preview, searchConfig);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const { start, end } = previewDateRange(preview);
    const rangePath = this.rangeCachePath(monthKey, start, end, searchConfig);
    if (fs.existsSync(rangePath)) {
      fs.unlinkSync(rangePath);
    }
  }

  private _readCacheFile(filePath: string): FillPreview | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const cache = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FillCacheFile;
      return {
        scope: cache.scope,
        anchorDate: cache.anchorDate,
        rangeStart: cache.rangeStart,
        rangeEnd: cache.rangeEnd,
        dates: cache.days.map((d) => d.date),
        days: cache.days,
        collectedAt: cache.collectedAt,
        error: cache.error,
      };
    } catch {
      return null;
    }
  }
}
