import * as React from 'react';
import type { DailyProjectLink } from '@host-utils/types/dailyLog';
import {
  reconcileProjectLinks,
  setProjectLink,
} from '@host-utils/utils/projectLinks';
import { EditableItemList } from '../../shared/views/EditableItemList';

interface ProjectAssignmentSelectProps {
  value: string | null;
  repositoryOptions: string[];
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
    {repositoryOptions.map((originUrl) => (
      <option key={originUrl} value={originUrl}>
        {originUrl}
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
  repositoryOptions: string[];
  onChange: (items: string[], projectLinks: DailyProjectLink[]) => void;
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
      />
      {items.map((content) => {
        const link = projectLinks.find(
          (candidate) =>
            candidate.field === field && candidate.content === content,
        );
        return (
          <div
            key={`${field}:${content}`}
            className="user-field-project-row"
          >
            <span title={content}>{content}</span>
            <ProjectAssignmentSelect
              value={link?.projectOriginUrl ?? null}
              repositoryOptions={repositoryOptions}
              onChange={(originUrl) =>
                onChange(
                  items,
                  setProjectLink(
                    projectLinks,
                    field,
                    content,
                    originUrl,
                  ),
                )
              }
            />
          </div>
        );
      })}
    </section>
  );
};
