import * as React from 'react';
import type {
  DailyLog,
  DailyProjectLink,
} from '@host-utils/types/dailyLog';
import { GeneratedFieldList } from '../views/GeneratedFieldList';
import {
  ProjectAssignmentSelect,
  UserFieldList,
} from '../views/UserFieldList';

interface DailyPageProps {
  log: DailyLog;
  loading: boolean;
  repositoryOptions: string[];
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
  onSyncToCompleted: (items: string[], label: string) => void;
  onSyncGeneratedJson: () => void;
}

export const DailyPage: React.FC<DailyPageProps> = ({
  log,
  loading,
  repositoryOptions,
  showGitlog,
  showGitCommit,
  showPlan,
  showBlockers,
  showNotes,
  onUserFieldChange,
  onNotesChange,
  onNotesProjectChange,
  onSyncToCompleted,
  onSyncGeneratedJson,
}) => {
  if (loading) {
    return <div className="daily-page__empty">加载中...</div>;
  }

  return (
    <div className="daily-page">
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
        <GeneratedFieldList
          label="🧾 GitLog"
          items={log.gitlog || []}
          onSyncToCompleted={onSyncToCompleted}
        />
      )}
      <GeneratedFieldList
        label="🤖 AILog"
        items={log.ailog || []}
        onSyncToCompleted={onSyncToCompleted}
      />
      {showGitCommit && (
        <GeneratedFieldList
          label="📝 GitCommit"
          items={log.gitCommit || []}
        />
      )}
      <GeneratedFieldList
        label="🔗 相关仓库"
        items={log.origin_url || []}
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
    </div>
  );
};
