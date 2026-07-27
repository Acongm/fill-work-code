import * as React from 'react';
import { OverlayHeader } from '../../shared/views/OverlayHeader';
import { EditableItemList } from '../../shared/views/EditableItemList';
import {
  collectRequestFromPreview,
  formatFillAnchorLabel,
  resolveCustomRange,
} from '@host-utils/utils/fillAnchor';
import type { FillPreview, FillPreviewDay } from '@host-utils/types/fillPreview';

export type { FillPreview, FillPreviewDay } from '@host-utils/types/fillPreview';
export type FillPreviewSource = 'git' | 'ai';

interface FillReviewOverlayProps {
  preview: FillPreview;
  onChange: (preview: FillPreview) => void;
  onBack: () => void;
  onApplyGit: () => void;
  onApplyAi: () => void;
  onRepolish: () => void;
}

function dayIncluded(day: FillPreviewDay): boolean {
  return day.includeInApply !== false;
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
            ? '确认 SQLite 中的 Git 采集结果后同步 JSON。生成字段只读，可按天决定是否写入。'
            : '确认 AI 润色结果后写入 SQLite 并同步只读 AILog，不会修改今日完成。'}
        </p>
        {preview.error && <div className="warning">{preview.error}</div>}
        {preview.days.map((day, index) => (
          <section key={day.date} className="fill-day">
            <div className="fill-day-header">
              <h4>{day.date}</h4>
              <label className="fill-day-include">
                <input
                  type="checkbox"
                  checked={dayIncluded(day)}
                  onChange={(e) =>
                    updateDay(index, { includeInApply: e.target.checked })
                  }
                />
                写入此日
              </label>
            </div>
            {isGitStep && (
              <>
                <EditableItemList
                  label="GitLog（只读）"
                  hint="由 SQLite 中的仓库与 Commit 事实生成"
                  items={day.gitlog}
                  readOnly
                  onChange={() => {}}
                />
                <EditableItemList
                  label="GitCommit（只读）"
                  hint="每条对应 SQLite 中的一次 Commit"
                  items={day.gitCommit}
                  readOnly
                  onChange={() => {}}
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
                label="AILog 候选（只读）"
                hint="确认后先写入 SQLite，再同步 JSON"
                items={day.ailogDraft}
                readOnly
                onChange={() => {}}
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
