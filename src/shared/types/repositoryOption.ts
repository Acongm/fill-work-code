export interface RepositoryOption {
  originUrl: string;
  name: string;
}

export function deriveRepositoryName(originUrl: string): string {
  const trimmed = originUrl.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.replace(/\.git$/i, '').split('/').pop() || trimmed;
}

export function toRepositoryOptions(
  originUrls: string[],
  nameByUrl: ReadonlyMap<string, string> = new Map(),
): RepositoryOption[] {
  const seen = new Set<string>();
  return originUrls.flatMap((originUrl) => {
    const normalized = originUrl.trim();
    if (!normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [
      {
        originUrl: normalized,
        name: nameByUrl.get(normalized) ?? deriveRepositoryName(normalized),
      },
    ];
  });
}
