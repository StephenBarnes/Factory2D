import { describe, expect, it } from "vitest";

import {
  loadCompletedPuzzleIds,
  PUZZLE_PROGRESS_STORAGE_KEY,
  recordPuzzleResult,
  saveCompletedPuzzleIds,
} from "../src/game/puzzle-progress";
import type { PuzzleId } from "../src/game/puzzles";
import { PuzzleResult } from "../src/simulation/puzzle-result";

function createStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("puzzle progress", () => {
  it("persists completed puzzle IDs in puzzle order", () => {
    const storage = createStorage();
    const completed = new Set<PuzzleId>(["beltworks", "first-shift"]);

    saveCompletedPuzzleIds(storage, completed);

    expect(storage.getItem(PUZZLE_PROGRESS_STORAGE_KEY)).toBe(
      '{"version":1,"completedPuzzleIds":["first-shift","beltworks"]}',
    );
    expect(loadCompletedPuzzleIds(storage)).toEqual(completed);
  });

  it("starts with no completions when progress has not been stored", () => {
    expect(loadCompletedPuzzleIds(createStorage())).toEqual(new Set());
  });

  it.each([
    "not JSON",
    "[]",
    '{"version":2,"completedPuzzleIds":[]}',
    '{"version":1,"completedPuzzleIds":"first-shift"}',
    '{"version":1,"completedPuzzleIds":["missing-puzzle"]}',
  ])("rejects malformed stored progress: %s", (serialized) => {
    const storage = createStorage();
    storage.setItem(PUZZLE_PROGRESS_STORAGE_KEY, serialized);

    expect(() => loadCompletedPuzzleIds(storage)).toThrow(/Stored|Invalid/);
  });

  it("records each won puzzle once and ignores non-winning results", () => {
    const completed = new Set<PuzzleId>();

    expect(recordPuzzleResult(completed, "first-shift", PuzzleResult.InProgress)).toBe(false);
    expect(recordPuzzleResult(completed, "first-shift", PuzzleResult.Lost)).toBe(false);
    expect(recordPuzzleResult(completed, "first-shift", PuzzleResult.Won)).toBe(true);
    expect(recordPuzzleResult(completed, "first-shift", PuzzleResult.Won)).toBe(false);
    expect(completed).toEqual(new Set<PuzzleId>(["first-shift"]));
  });
});
