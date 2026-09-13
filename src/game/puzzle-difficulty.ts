export const PUZZLE_DIFFICULTIES = {
  tutorial: { label: "Tutorial", mark: "🎓" },
  1: { label: "Easy", mark: "★" },
  2: { label: "Intermediate", mark: "★★" },
  3: { label: "Difficult", mark: "★★★" },
  4: { label: "Expert", mark: "★★★★" },
  5: { label: "Masterwork", mark: "★★★★★" },
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
