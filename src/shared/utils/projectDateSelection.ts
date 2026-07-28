import { normalizeCommitDay } from './dateFormat';

export function remainingSelectedDates(
  selectedDates: string[],
  generatedDates: string[],
): string[] {
  const generated = new Set(generatedDates.map(normalizeCommitDay));
  return selectedDates.filter(
    (date) => !generated.has(normalizeCommitDay(date)),
  );
}
