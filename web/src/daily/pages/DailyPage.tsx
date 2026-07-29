import * as React from 'react';
import type {
  DailyLog,
  DailyProjectLink,
} from '@host-utils/types/dailyLog';
import type { RepositoryOption } from '@host-utils/types/repositoryOption';
import { GeneratedFieldList } from '../views/GeneratedFieldList';
import {
  ProjectAssignmentSelect,
  UserFieldList,
} from '../views/UserFieldList';

interface DailyPageProps {
  log: DailyLog;
  dateLoading?: boolean;
  repositoryOptions: RepositoryOption[];
  showGitlog: boolean;
  showGitCommit: boolean;
  showPlan: boolean;
  showBlockers: boolean;
  showNotes: boolean;
  onUserFieldChange: (
    field: 'completed' | 'plan' | 'blockers',
    items: string[],
    projectLinks: DailyProjectLink[],
  ) => void;
  onNotesChange: (notes: string) => void;
  onNotesProjectChange: (originUrl: string | null) => void;
  onSyncGeneratedJson: () => void;
}

export const DailyPage: React.FC<DailyPageProps> = ({
  log,
  dateLoading = false,
  repositoryOptions,
  showGitlog,
  showGitCommit,
  showPlan,
  showBlockers,
  showNotes,
  onUserFieldChange,
  onNotesChange,
  onNotesProjectChange,
  onSyncGeneratedJson,
}) => {
  return (
    <div
      className={`daily-page${dateLoading ? ' daily-page--loading' : ''}`}
      aria-busy={dateLoading}
    >
      <UserFieldList
        field="completed"
        label="✅ 今日完成"
        placeholder="输入完成的任务..."
        items={log.completed}
        projectLinks={log.projectLinks || []}
        repositoryOptions={repositoryOptions}
        onChange={(items, links) =>
          onUserFieldChange('completed', items, links)
        }
      />

      {showPlan && (
        <UserFieldList
          field="plan"
          label="📝 明日计划"
          placeholder="输入明日计划..."
          items={log.plan}
          projectLinks={log.projectLinks || []}
          repositoryOptions={repositoryOptions}
          onChange={(items, links) =>
            onUserFieldChange('plan', items, links)
          }
        />
      )}
      {showBlockers && (
        <UserFieldList
          field="blockers"
          label="⚠️ 阻碍/问题"
          placeholder="输入阻碍或问题..."
          items={log.blockers}
          projectLinks={log.projectLinks || []}
          repositoryOptions={repositoryOptions}
          onChange={(items, links) =>
            onUserFieldChange('blockers', items, links)
          }
        />
      )}
      {showNotes && (
        <section className="daily-notes">
          <strong>📌 备注</strong>
          <textarea
            value={log.notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="其他备注..."
          />
          {log.notes.trim() && (
            <ProjectAssignmentSelect
              value={
                log.projectLinks?.find(
                  (link) =>
                    link.field === 'notes' &&
                    link.content === log.notes.trim(),
                )?.projectOriginUrl ?? null
              }
              repositoryOptions={repositoryOptions}
              onChange={onNotesProjectChange}
            />
          )}
        </section>
      )}

      <div className="generated-fields-toolbar">
        <span>程序生成字段</span>
        <button
          type="button"
          className="btn secondary btn-sm"
          onClick={onSyncGeneratedJson}
        >
          同步 JSON
        </button>
      </div>
      {showGitlog && (
        <GeneratedFieldList label="🧾 GitLog" items={log.gitlog || []} />
      )}
      <GeneratedFieldList
        label="🤖 AILog"
        items={log.ailog || []}
        sourceHint="Cursor/Codex/Qoder 对话采集 · JSON 只读"
      />
      {showGitCommit && (
        <GeneratedFieldList
          label="📝 GitCommit"
          items={log.gitCommit || []}
        />
      )}
      <GeneratedFieldList label="🔗 相关仓库" items={log.origin_url || []} />
    </div>
  );
};
