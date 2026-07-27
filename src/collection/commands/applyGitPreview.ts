import type { Database } from '../../database/types/database';
import type { WorkLogManager } from '../../daily/utils/workLogManager';
import { GeneratedDailyProjector } from '../../daily/commands/generatedDailyProjector';
import type { FillPreview } from '../../shared/types/fillPreview';
import { collectRequestFromPreview } from '../../shared/utils/fillAnchor';

export interface StructuredEvidenceResult {
  hydrated: boolean;
  missingMonths: string[];
}

export interface ApplyGitPreviewDeps {
  database: Database;
  workLogManager: WorkLogManager;
  ensureStructuredEvidence: () => Promise<StructuredEvidenceResult>;
  onLog?: (line: string) => void;
}

export async function applyGitPreview(
  deps: ApplyGitPreviewDeps,
  preview: FillPreview,
): Promise<{ applied: number }> {
  const days = preview.days.filter((day) => day.includeInApply !== false);
  if (days.length === 0) {
    return { applied: 0 };
  }

  const evidence = await deps.ensureStructuredEvidence();
  if (evidence.missingMonths.length > 0) {
    throw new Error(
      `缺少 ${evidence.missingMonths.join(', ')} 的结构化 Git 证据，请重新扫描`,
    );
  }
  if (!evidence.hydrated) {
    throw new Error('没有可用的结构化 Git 证据，请重新扫描');
  }

  const projector = new GeneratedDailyProjector(
    deps.database,
    deps.workLogManager,
    deps.onLog,
  );
  const revision = Date.now();
  for (const day of days) {
    await projector.project(day.date, ['git'], revision);
    day.appliedGit = true;
  }
  return { applied: days.length };
}

export function requestForGitPreview(preview: FillPreview) {
  return collectRequestFromPreview(preview);
}
