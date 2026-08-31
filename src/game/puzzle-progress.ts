import { PUZZLES, type PuzzleId } from "./puzzles";
import { PuzzleResult } from "../simulation/puzzle-result";

export const PUZZLE_PROGRESS_STORAGE_KEY = "factory2d.puzzle-progress";
const PUZZLE_PROGRESS_VERSION = 1;

type PuzzleProgressStorage = Pick<Storage, "getItem" | "setItem">;

interface StoredPuzzleProgress {
  readonly version: typeof PUZZLE_PROGRESS_VERSION;
  readonly completedPuzzleIds: readonly PuzzleId[];
}

function parsePuzzleId(value: unknown, index: number): PuzzleId {
  const puzzle = PUZZLES.find((candidate) => candidate.id === value);
  if (puzzle === undefined) {
    throw new Error(`Invalid completed puzzle ID at index ${index}`);
  }
  return puzzle.id;
}

function deserializeCompletedPuzzleIds(serialized: string): Set<PuzzleId> {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Stored puzzle progress is not valid JSON");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored puzzle progress must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== PUZZLE_PROGRESS_VERSION) {
    throw new Error("Stored puzzle progress has an unsupported version");
  }
  if (!Array.isArray(record.completedPuzzleIds)) {
    throw new Error("Stored completed puzzle IDs must be an array");
  }

  return new Set(
    record.completedPuzzleIds.map((id, index) => parsePuzzleId(id, index)),
  );
}

function serializeCompletedPuzzleIds(completedPuzzleIds: ReadonlySet<PuzzleId>): string {
  const progress: StoredPuzzleProgress = {
    version: PUZZLE_PROGRESS_VERSION,
    completedPuzzleIds: PUZZLES
      .filter((puzzle) => completedPuzzleIds.has(puzzle.id))
      .map((puzzle) => puzzle.id),
  };
  return JSON.stringify(progress);
}

export function loadCompletedPuzzleIds(storage: PuzzleProgressStorage): Set<PuzzleId> {
  const serialized = storage.getItem(PUZZLE_PROGRESS_STORAGE_KEY);
  return serialized === null ? new Set() : deserializeCompletedPuzzleIds(serialized);
}

export function saveCompletedPuzzleIds(
  storage: PuzzleProgressStorage,
  completedPuzzleIds: ReadonlySet<PuzzleId>,
): void {
  storage.setItem(
    PUZZLE_PROGRESS_STORAGE_KEY,
    serializeCompletedPuzzleIds(completedPuzzleIds),
  );
}

export function recordPuzzleResult(
  completedPuzzleIds: Set<PuzzleId>,
  puzzleId: PuzzleId,
  result: PuzzleResult,
): boolean {
  if (result !== PuzzleResult.Won || completedPuzzleIds.has(puzzleId)) {
    return false;
  }
  completedPuzzleIds.add(puzzleId);
  return true;
}
