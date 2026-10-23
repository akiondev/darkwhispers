/** Final-score colour bands. Incomplete evidence never earns the perfect-score badge. */
export function scoreBand(value: number | null, provisional = false): string {
  if (value === null) return 'unranked';
  const score = Math.floor(value + 1e-8);
  if (score >= 100) return provisional ? 'provisional' : 'perfect';
  if (score >= 99) return 'pink';
  if (score >= 90) return 'purple';
  if (score >= 70) return 'blue';
  if (score >= 50) return 'green';
  if (score >= 30) return 'yellow';
  return 'grey';
}
export function scoreLabel(value: number | null, provisional = false): string {
  if (value === null) return '—';
  // Rounding 99.96 to 100 must never create a perfect-score badge.
  const displayed = value >= 100 ? 100 : Math.floor(value * 10) / 10;
  return `${provisional ? '~' : ''}${displayed.toFixed(Number.isInteger(displayed) ? 0 : 1)}`;
}
