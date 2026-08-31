import { describe, expect, it } from "vitest";

import {
  loadCompletedPuzzleIds,
  PUZZLE_PROGRESS_STORAGE_KEY,
  recordPuzzleResult,
  saveCompletedPuzzleIds,
} from "../src/game/puzzle-progress";
import { PUZZLES, type PuzzleId } from "../src/game/puzzles";
import { PuzzleResult } from "../src/simulation/puzzle-result";
import { expectDefined } from "../src/util/assert";

function createStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const SHIPPED_PUZZLE_ID = expectDefined(
  PUZZLES[0],
  "Missing shipped puzzle",
).id;

describe("puzzle progress", () => {
  it("persists completed puzzle IDs in puzzle order", () => {
    const storage = createStorage();
    const completed = new Set<PuzzleId>(
      [...PUZZLES].reverse().map((puzzle) => puzzle.id),
    );

    saveCompletedPuzzleIds(storage, completed);

    expect(storage.getItem(PUZZLE_PROGRESS_STORAGE_KEY)).toBe(JSON.stringify({
      version: 1,
      completedPuzzleIds: PUZZLES.map((puzzle) => puzzle.id),
    }));
    expect(loadCompletedPuzzleIds(storage)).toEqual(completed);
  });

  it("starts with no completions when progress has not been stored", () => {
    expect(loadCompletedPuzzleIds(createStorage())).toEqual(new Set());
  });

  it.each([
    "not JSON",
    "[]",
    '{"version":2,"completedPuzzleIds":[]}',
    `{"version":1,"completedPuzzleIds":"${SHIPPED_PUZZLE_ID}"}`,
    '{"version":1,"completedPuzzleIds":["missing-puzzle"]}',
  ])("rejects malformed stored progress: %s", (serialized) => {
    const storage = createStorage();
    storage.setItem(PUZZLE_PROGRESS_STORAGE_KEY, serialized);

    expect(() => loadCompletedPuzzleIds(storage)).toThrow(/Stored|Invalid/);
  });

  it("records each won puzzle once and ignores non-winning results", () => {
    const completed = new Set<PuzzleId>();

    expect(recordPuzzleResult(completed, SHIPPED_PUZZLE_ID, PuzzleResult.InProgress)).toBe(false);
    expect(recordPuzzleResult(completed, SHIPPED_PUZZLE_ID, PuzzleResult.Lost)).toBe(false);
    expect(recordPuzzleResult(completed, SHIPPED_PUZZLE_ID, PuzzleResult.Won)).toBe(true);
    expect(recordPuzzleResult(completed, SHIPPED_PUZZLE_ID, PuzzleResult.Won)).toBe(false);
    expect(completed).toEqual(new Set<PuzzleId>([SHIPPED_PUZZLE_ID]));
  });
});
