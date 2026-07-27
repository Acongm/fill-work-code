export function remainingSelectedDates(
  selectedDates: string[],
  generatedDates: string[],
): string[] {
  const generated = new Set(generatedDates);
  return selectedDates.filter((date) => !generated.has(date));
}
