export function normalizeCommitDay(raw: string): string {
  const trimmed = raw.trim();
  const separated = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (separated) {
    return `${separated[1]}-${separated[2]}-${separated[3]}`;
  }
  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  return trimmed.slice(0, 10);
}
