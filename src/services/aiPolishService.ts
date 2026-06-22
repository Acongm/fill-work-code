import type { DailyLog } from '../lib/workLogManager';
import type { FillPreviewDay } from '../utils/types/fillPreview';
import {
  filterNoiseLines,
  isReleaseNoiseText,
  truncateForLog,
} from '../utils/ailogFilter';
import {
  AILOG_MODULE_SEP,
  buildRepoPrefixHints,
  normalizeAilogPrefixes,
  parseAilogItem,
} from '../utils/ailogPrefix';
import { OpenAiCompatibleClient } from './openAiCompatibleClient';
import { resolveAiSystemPrompt } from '../features/settings/aiSystemPrompt';
import type { PluginSettings } from '../features/settings/pluginSettings';
import { AI_PRESETS } from '../features/settings/pluginSettings';
import {
  applyWeekendAilogRollforward,
  buildAiPolishDayInputs,
} from '../utils/weekendCommitRollforward';

const client = new OpenAiCompatibleClient();

const AILOG_MAX_ITEMS = 5;
const AILOG_MAX_PER_MODULE = 2;

/** 按模块合并 AILog：全天 1~5 条，每模块 1~2 条 */
export function consolidateAilogItems(
  items: string[],
  maxTotal = AILOG_MAX_ITEMS,
  maxPerModule = AILOG_MAX_PER_MODULE,
): string[] {
  const trimmed = items.map((s) => s.trim()).filter(Boolean);
  if (trimmed.length === 0) {
    return [];
  }

  const byModule = new Map<string, string[]>();
  for (const raw of trimmed) {
    const { prefix, content } = parseAilogItem(raw);
    if (!content) {
      continue;
    }
    const list = byModule.get(prefix) ?? [];
    list.push(content);
    byModule.set(prefix, list);
  }

  const buildLines = (perModuleLimit: number): string[] => {
    const out: string[] = [];
    for (const [prefix, contents] of byModule) {
      if (contents.length <= perModuleLimit) {
        for (const c of contents) {
          out.push(`${prefix}${AILOG_MODULE_SEP}${c}`);
        }
        continue;
      }
      const chunkSize = Math.max(1, Math.ceil(contents.length / perModuleLimit));
      for (let i = 0; i < contents.length; i += chunkSize) {
        const slice = contents.slice(i, i + chunkSize);
        out.push(`${prefix}${AILOG_MODULE_SEP}${slice.join('；')}`);
      }
    }
    return out;
  };

  let perModuleLimit = maxPerModule;
  let lines = buildLines(perModuleLimit);
  while (lines.length > maxTotal && perModuleLimit > 1) {
    perModuleLimit -= 1;
    lines = buildLines(perModuleLimit);
  }

  if (lines.length <= maxTotal) {
    return lines;
  }

  lines = buildLines(1);
  if (lines.length <= maxTotal) {
    return lines;
  }

  const kept = lines.slice(0, maxTotal - 1);
  const overflow = lines.slice(maxTotal - 1).map((line) => parseAilogItem(line).content);
  kept.push(`misc${AILOG_MODULE_SEP}${overflow.join('；')}`);
  return kept;
}

function filterAilogItems(items: string[]): { kept: string[]; dropped: number } {
  const kept: string[] = [];
  let dropped = 0;
  for (const item of items) {
    const { content } = parseAilogItem(item);
    if (isReleaseNoiseText(item) || isReleaseNoiseText(content)) {
      dropped += 1;
    } else {
      kept.push(item);
    }
  }
  return { kept, dropped };
}

function prepareDayForAi(day: FillPreviewDay): {
  day: FillPreviewDay;
  inputDropped: number;
} {
  const gitlog = filterNoiseLines(day.gitlog);
  const gitCommit = filterNoiseLines(day.gitCommit);
  const inputDropped = gitlog.dropped + gitCommit.dropped;
  return {
    day: {
      ...day,
      gitlog: gitlog.kept,
      gitCommit: gitCommit.kept,
    },
    inputDropped,
  };
}

function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return '***';
  }
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export class AiPolishService {
  async polishDay(
    day: FillPreviewDay,
    settings: PluginSettings,
    apiKey: string,
    onLog?: (line: string) => void,
  ): Promise<FillPreviewDay> {
    if (!apiKey) {
      return {
        ...day,
        warnings: [...day.warnings, '未配置 AI API Key'],
      };
    }

    const preset = AI_PRESETS[settings.aiPreset];
    const headers =
      preset.useApiKeyHeader || settings.aiUseApiKeyHeader
        ? { 'api-key': apiKey }
        : undefined;
    const baseUrl = settings.aiBaseUrl || preset.baseUrl;
    const model = settings.aiModel || preset.defaultModel;

    const { day: aiInput, inputDropped } = prepareDayForAi(day);
    const repoHints = buildRepoPrefixHints(
      aiInput.gitlog,
      aiInput.originUrl || [],
    );

    const systemPrompt = resolveAiSystemPrompt(settings.aiSystemPrompt);

    const userPayload = {
      date: aiInput.date,
      completed: aiInput.completed,
      gitlog: aiInput.gitlog,
      gitCommit: aiInput.gitCommit,
      origin_url: aiInput.originUrl || [],
      repoHints,
    };
    const userJson = JSON.stringify(userPayload, null, 2);

    const thinking = settings.aiThinkingEnabled ? 'enabled' : 'disabled';
    const timeoutMs = settings.aiTimeoutMs > 0 ? settings.aiTimeoutMs : 180_000;
    const temperature = settings.aiTemperature ?? 0.2;
    const reasoningEffort = settings.aiReasoningEffort || 'high';

    onLog?.(`[AI] ── ${aiInput.date} 请求 ──`);
    onLog?.(
      `[AI] 入参 model=${model} base=${baseUrl} key=${maskApiKey(apiKey)} thinking=${thinking}` +
        (thinking === 'enabled' ? ` effort=${reasoningEffort}` : ` temperature=${temperature}`) +
        ` timeout=${Math.round(timeoutMs / 1000)}s`,
    );
    onLog?.(
      `[AI] 入参统计 completed=${userPayload.completed.length} gitlog=${userPayload.gitlog.length} gitCommit=${userPayload.gitCommit.length}` +
        (inputDropped > 0 ? `（已剔除发布/版本类 ${inputDropped} 条）` : ''),
    );
    onLog?.(`[AI] 入参 body:\n${truncateForLog(userJson)}`);

    try {
      const { content: raw, reasoningContent } = await client.chat(
        {
          baseUrl,
          apiKey,
          model,
          timeoutMs,
          extraHeaders: headers,
        },
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userJson },
        ],
        {
          maxTokens: 4096,
          temperature,
          responseFormatJson: true,
          thinking,
          reasoningEffort: thinking === 'enabled' ? reasoningEffort : undefined,
          stream: true,
          streamReasoningLog: settings.aiShowReasoningStream,
          onLog,
        },
      );

      if (
        reasoningContent &&
        !settings.aiShowReasoningStream
      ) {
        onLog?.(
          `[AI] reasoning 摘要（不写入 AILog）:\n${truncateForLog(reasoningContent, 800)}`,
        );
      } else if (reasoningContent && settings.aiShowReasoningStream) {
        onLog?.(
          `[AI] reasoning 完成，共 ${reasoningContent.length} 字符（已流式输出）`,
        );
      }
      onLog?.(`[AI] content 摘要:\n${truncateForLog(raw)}`);

      const parsed = JSON.parse(raw) as {
        items?: string[];
        warnings?: string[];
      };
      const rawItems = Array.isArray(parsed.items)
        ? parsed.items.map((item) => String(item).trim()).filter(Boolean)
        : [];
      const noiseFiltered = filterAilogItems(rawItems);
      const normalized = normalizeAilogPrefixes(noiseFiltered.kept, repoHints);
      const items = consolidateAilogItems(normalized);
      const warnings = [
        ...day.warnings,
        ...(Array.isArray(parsed.warnings)
          ? parsed.warnings.map((w) => String(w).trim()).filter(Boolean)
          : []),
      ];

      if (inputDropped > 0) {
        warnings.push(`已忽略 ${inputDropped} 条发布/版本类 commit，未送入 AI`);
      }
      if (noiseFiltered.dropped > 0) {
        warnings.push(`已过滤 ${noiseFiltered.dropped} 条 AI 返回中的发布/版本描述`);
      }
      if (rawItems.length > items.length) {
        warnings.push(
          `AILog 已合并：${rawItems.length} 条 → ${items.length} 条（目标 1~${AILOG_MAX_ITEMS} 条）`,
        );
      }

      onLog?.(
        `[AI] 出参 items=${items.length} warnings=${warnings.length} 内容: ${items.join(' | ') || '（空）'}`,
      );

      if (items.length === 0) {
        warnings.push('AI 未返回可写入的 AILog 条目');
      }

      return {
        ...day,
        ailogDraft: items.length > 0 ? items : day.ailogDraft,
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog?.(`[AI] 失败: ${message}`);
      return {
        ...day,
        warnings: [...day.warnings, `AI 润色失败: ${message}`],
      };
    }
  }

  async polishDays(
    days: FillPreviewDay[],
    settings: PluginSettings,
    apiKey: string,
    existingLogs: Record<string, DailyLog | null>,
    onProgress?: (line: string) => void,
  ): Promise<FillPreviewDay[]> {
    const preset = AI_PRESETS[settings.aiPreset];
    onProgress?.(
      `[AI] 开始润色 ${days.length} 天 | model=${settings.aiModel || preset.defaultModel} | 输出通俗日报 AILog（非 commit 翻译）`,
    );

    const polishInputs = settings.weekendRollforward
      ? buildAiPolishDayInputs(days)
      : days;
    const resultByDate = new Map<string, FillPreviewDay>(
      days.map((day) => [day.date, { ...day }]),
    );
    const total = polishInputs.length;
    const concurrency = 2;
    let index = 0;
    const worker = async () => {
      while (index < polishInputs.length) {
        const i = index;
        index += 1;
        const day = polishInputs[i];
        onProgress?.(`润色 ${day.date} (${i + 1}/${total})…`);
        const enriched = {
          ...day,
          completed: day.completed.length
            ? day.completed
            : existingLogs[day.date]?.completed || [],
          gitlog: day.gitlog.length
            ? day.gitlog
            : existingLogs[day.date]?.gitlog || [],
          gitCommit: day.gitCommit.length
            ? day.gitCommit
            : existingLogs[day.date]?.gitCommit || [],
        };
        const polished = await this.polishDay(enriched, settings, apiKey, onProgress);
        resultByDate.set(day.date, {
          ...(resultByDate.get(day.date) || day),
          ...polished,
          date: day.date,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
    const rolled = settings.weekendRollforward
      ? applyWeekendAilogRollforward([...resultByDate.values()])
      : [...resultByDate.values()];
    onProgress?.(
      settings.weekendRollforward
        ? `[AI] 润色完成，共 ${rolled.length} 天（周末提交已按周一归类）`
        : `[AI] 润色完成，共 ${rolled.length} 天`,
    );
    return rolled;
  }
}
