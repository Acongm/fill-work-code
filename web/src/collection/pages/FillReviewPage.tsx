import * as React from 'react';
import { OverlayHeader } from '../../shared/views/OverlayHeader';
import { EditableItemList } from '../../shared/views/EditableItemList';
import {
  CommitItem,
  parseGitCommitLine,
  syncGitlogWithCommits,
} from '../views/CommitItem';
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

  const toggleCommit = (dayIndex: number, line: string, checked: boolean) => {
    if (checked) {
      return;
    }
    const day = preview.days[dayIndex];
    const selected = new Set(day.gitCommit.map((entry) => entry.trim()));
    selected.delete(line.trim());
    const synced = syncGitlogWithCommits(day.gitlog, day.gitCommit, selected);
    updateDay(dayIndex, synced);
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
            ? '确认 Git 采集结果后写入 GitLog、GitCommit 与相关仓库。可勾选 commit 与按天决定是否写入。'
            : '确认 AI 润色结果后写入 AILog。基于已有 Git 采集数据润色，不会重复执行脚本采集。'}
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
                  label="今日完成（可选，写入 completed）"
                  hint="手动维护的完成项，会随 Git 字段一并保存"
                  items={day.completed}
                  onChange={(completed) => updateDay(index, { completed })}
                />
                {day.gitCommit.length > 0 && (
                  <div className="commit-picker">
                    <div className="editable-list-label">Commit 勾选</div>
                    <p className="setting-hint">取消勾选将从 GitCommit / GitLog 中移除</p>
                    {day.gitCommit.map((line) => {
                      const parsed = parseGitCommitLine(line);
                      return (
                        <CommitItem
                          key={line}
                          commit={parsed}
                          checked
                          onChange={(checked) => toggleCommit(index, line, checked)}
                        />
                      );
                    })}
                  </div>
                )}
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
