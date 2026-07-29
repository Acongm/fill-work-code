import * as React from 'react';
import type { DailyProjectLink } from '@host-utils/types/dailyLog';
import {
  deriveRepositoryName,
  type RepositoryOption,
} from '@host-utils/types/repositoryOption';
import {
  reconcileProjectLinks,
  setProjectLink,
} from '@host-utils/utils/projectLinks';
import { EditableItemList } from '../../shared/views/EditableItemList';

interface ProjectAssignmentSelectProps {
  value: string | null;
  repositoryOptions: RepositoryOption[];
  onChange: (originUrl: string | null) => void;
}

export const ProjectAssignmentSelect: React.FC<
  ProjectAssignmentSelectProps
> = ({ value, repositoryOptions, onChange }) => (
  <select
    className="user-field-project-select"
    value={value || ''}
    onChange={(event) => onChange(event.target.value || null)}
    aria-label="项目归属"
  >
    <option value="">未归属</option>
    {repositoryOptions.map((option) => (
      <option key={option.originUrl} value={option.originUrl}>
        {option.name}
      </option>
    ))}
  </select>
);

interface UserFieldListProps {
  field: 'completed' | 'plan' | 'blockers';
  label: string;
  hint?: string;
  placeholder: string;
  items: string[];
  projectLinks: DailyProjectLink[];
  repositoryOptions: RepositoryOption[];
  onChange: (items: string[], projectLinks: DailyProjectLink[]) => void;
}

function repositoryNameFor(
  originUrl: string | null | undefined,
  repositoryOptions: RepositoryOption[],
): string | null {
  if (!originUrl) {
    return null;
  }
  return (
    repositoryOptions.find((option) => option.originUrl === originUrl)?.name ??
    deriveRepositoryName(originUrl)
  );
}

export const UserFieldList: React.FC<UserFieldListProps> = ({
  field,
  label,
  hint,
  placeholder,
  items,
  projectLinks,
  repositoryOptions,
  onChange,
}) => {
  const updateItems = (nextItems: string[]) => {
    onChange(
      nextItems,
      reconcileProjectLinks(field, items, nextItems, projectLinks),
    );
  };

  return (
    <section className="user-field">
      <EditableItemList
        label={label}
        hint={hint}
        items={items}
        placeholder={placeholder}
        onChange={updateItems}
        renderItemMeta={(content, _idx, isEditing) => {
          const link = projectLinks.find(
            (candidate) =>
              candidate.field === field && candidate.content === content,
          );
          const originUrl = link?.projectOriginUrl ?? null;
          if (isEditing) {
            return (
              <div className="user-field-project-meta">
                <ProjectAssignmentSelect
                  value={originUrl}
                  repositoryOptions={repositoryOptions}
                  onChange={(nextOriginUrl) =>
                    onChange(
                      items,
                      setProjectLink(
                        projectLinks,
                        field,
                        content,
                        nextOriginUrl,
                      ),
                    )
                  }
                />
              </div>
            );
          }
          const repoName = repositoryNameFor(originUrl, repositoryOptions);
          if (!repoName) {
            return null;
          }
          return (
            <div className="user-field-project-meta user-field-project-meta--view">
              {repoName}
            </div>
          );
        }}
      />
    </section>
  );
};
