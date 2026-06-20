import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { PluginSettings } from '../features/settings/pluginSettings';
import type { FillCacheFile, FillPreview, FillScope } from '../utils/types/fillPreview';

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

  save(
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

  remove(
    monthKey: string,
    preview: FillPreview,
    searchConfig?: FillCacheSearchConfig,
  ): void {
    const filePath = this.cachePath(monthKey, preview, searchConfig);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
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
