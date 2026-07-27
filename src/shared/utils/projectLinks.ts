import type {
  DailyProjectLink,
} from '../types/dailyLog';

export function reconcileProjectLinks(
  field: DailyProjectLink['field'],
  previousItems: string[],
  nextItems: string[],
  links: DailyProjectLink[],
): DailyProjectLink[] {
  const otherFields = links.filter((link) => link.field !== field);
  const currentLinks = links.filter((link) => link.field === field);
  const nextLinks = nextItems.map((content, index) => {
    const direct = currentLinks.find((link) => link.content === content);
    if (direct) {
      return direct;
    }
    const previousContent = previousItems[index];
    const previous = currentLinks.find(
      (link) => link.content === previousContent,
    );
    if (previous) {
      return { ...previous, content };
    }
    return {
      field,
      content,
      assignment: 'unassigned' as const,
      projectOriginUrl: null,
    };
  });
  return [...otherFields, ...nextLinks];
}

export function setProjectLink(
  links: DailyProjectLink[],
  field: DailyProjectLink['field'],
  content: string,
  projectOriginUrl: string | null,
): DailyProjectLink[] {
  const next: DailyProjectLink = {
    field,
    content,
    assignment: projectOriginUrl ? 'project' : 'unassigned',
    projectOriginUrl,
  };
  const index = links.findIndex(
    (link) => link.field === field && link.content === content,
  );
  if (index < 0) {
    return [...links, next];
  }
  return links.map((link, linkIndex) => (linkIndex === index ? next : link));
}
