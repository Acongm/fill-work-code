import * as React from 'react';
import { OverlayHeader } from '../../components/ui/OverlayHeader';
import { EditableItemList } from '../../components/ui/EditableItemList';
import {
  collectRequestFromPreview,
  formatFillAnchorLabel,
  resolveCustomRange,
} from '@host-utils/fillAnchor';

export interface FillPreviewDay {
  date: string;
  completed: string[];
  gitlog: string[];
  gitCommit: string[];
  originUrl: string[];
  ailogDraft: string[];
  warnings: string[];
}

export type FillPreviewSource = 'git' | 'ai';

export interface FillPreview {
  scope: string;
  anchorDate?: string;
  rangeStart?: string;
  rangeEnd?: string;
  dates: string[];
  days: FillPreviewDay[];
  source?: FillPreviewSource;
  error?: string;
}

interface FillReviewOverlayProps {
  preview: FillPreview;
  onChange: (preview: FillPreview) => void;
  onBack: () => void;
  onApplyGit: () => void;
  onApplyAi: () => void;
  onRepolish: () => void;
}

export const FillReviewOverlay: React.FC<FillReviewOverlayProps> = ({
  preview,
  onChange,
  onBack,
  onApplyGit,
  onApplyAi,
  onRepolish,
}) => {
  const source = preview.source ?? 'git';
  const isGitStep = source === 'git';
  const isAiStep = source === 'ai';

  const updateDay = (index: number, patch: Partial<FillPreviewDay>) => {
    const days = preview.days.map((day, i) =>
      i === index ? { ...day, ...patch } : day,
    );
    onChange({ ...preview, days });
  };

  const scopeLabel =
    preview.scope === 'workWeek'
      ? '本周'
      : preview.scope === 'custom'
        ? '自定义'
        : preview.scope === 'day'
          ? '单日'
          : preview.scope;
  const anchorDate = preview.anchorDate || preview.dates[0] || '';
  const collectRequest = collectRequestFromPreview({
    scope: preview.scope as 'day' | 'workWeek' | 'custom',
    anchorDate,
    rangeStart: preview.rangeStart,
    rangeEnd: preview.rangeEnd,
  });
  const anchorLabel = formatFillAnchorLabel(
    collectRequest.scope,
    collectRequest.anchorDate,
    resolveCustomRange(collectRequest),
  );
  const stepLabel = isGitStep ? 'Git 采集确认' : 'AI 润色确认';

  return (
    <section className="page-overlay fill-review-overlay">
      <OverlayHeader
        title={`${stepLabel} · ${scopeLabel} · ${anchorLabel}`}
        onBack={onBack}
      />
      <div className="overlay-body fill-review-body">
        <p className="fill-review-note">
          {isGitStep
            ? '确认 Git 采集结果后写入 GitLog、GitCommit 与相关仓库。「今日完成」仅在日报页手动维护。'
            : '确认 AI 润色结果后写入 AILog。基于已有 Git 采集数据润色，不会重复执行脚本采集。'}
        </p>
        {preview.error && <div className="warning">{preview.error}</div>}
        {preview.days.map((day, index) => (
          <section key={day.date} className="fill-day">
            <h4>{day.date}</h4>
            {isGitStep && (
              <>
                <EditableItemList
                  label="GitLog（整理后，写入 gitlog）"
                  hint="按仓库合并的 commit 摘要"
                  items={day.gitlog}
                  onChange={(gitlog) => updateDay(index, { gitlog })}
                />
                <EditableItemList
                  label="GitCommit（原始，写入 gitCommit）"
                  hint="每条对应一次 commit，格式：短SHA + 标题"
                  items={day.gitCommit}
                  onChange={(gitCommit) => updateDay(index, { gitCommit })}
                />
                <EditableItemList
                  label="相关仓库"
                  hint="来自当日 commit 的 origin_url"
                  items={day.originUrl}
                  readOnly
                  onChange={() => {}}
                />
              </>
            )}
            {isAiStep && (
              <EditableItemList
                label="AILog 候选"
                hint="英文前缀（项目/项目-模块）+ 中文事项，确认后写入 ailog"
                items={day.ailogDraft}
                onChange={(ailogDraft) => updateDay(index, { ailogDraft })}
              />
            )}
            {day.warnings.length > 0 && (
              <div className="warning">{day.warnings.join(' | ')}</div>
            )}
          </section>
        ))}
      </div>
      <footer className="overlay-footer">
        {isAiStep && (
          <button type="button" className="btn secondary" onClick={onRepolish}>
            重新 AI 润色
          </button>
        )}
        {isGitStep && (
          <button type="button" className="btn" onClick={onApplyGit}>
            确认写入 Git 字段
          </button>
        )}
        {isAiStep && (
          <button type="button" className="btn" onClick={onApplyAi}>
            确认写入 AILog
          </button>
        )}
      </footer>
    </section>
  );
};
