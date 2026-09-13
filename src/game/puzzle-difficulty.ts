export const PUZZLE_DIFFICULTIES = {
  tutorial: { label: "Tutorial puzzle", mark: "🎓" },
  1: { label: "Easy — 1 of 5 stars", mark: "★" },
  2: { label: "Medium — 2 of 5 stars", mark: "★★" },
  3: { label: "Hard — 3 of 5 stars", mark: "★★★" },
  4: { label: "Very Hard — 4 of 5 stars", mark: "★★★★" },
  5: { label: "Expert — 5 of 5 stars", mark: "★★★★★" },
} as const;

export type PuzzleDifficulty = keyof typeof PUZZLE_DIFFICULTIES;

export function parsePuzzleDifficulty(value: unknown): PuzzleDifficulty {
  if (
    value === "tutorial" || value === 1 || value === 2 || value === 3 ||
    value === 4 || value === 5
  ) {
    return value;
  }
  throw new Error('Puzzle difficulty must be "tutorial" or an integer from 1 through 5');
}
