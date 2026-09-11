/** Round only for display; stored scores and best-score comparisons retain precision. */
export function formatPuzzleScore(score: number): string {
  return String(Number(score.toFixed(2)));
}
