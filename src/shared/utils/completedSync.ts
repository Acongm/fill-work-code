export function appendUniqueCompleted(
  completed: string[],
  selected: string[],
): string[] {
  const next = [...completed];
  const seen = new Set(completed.map((item) => item.trim()).filter(Boolean));
  for (const item of selected) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}
