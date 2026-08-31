import { describe, expect, it } from "vitest";

import {
  loadPuzzleSolutions,
  PUZZLE_SOLUTIONS_STORAGE_KEY,
  PuzzleSolutions,
  savePuzzleSolutions,
} from "../src/game/puzzle-solutions";
import { puzzleById } from "../src/game/puzzles";
import { serializeBoard } from "../src/simulation/board-export";
import { TileKind } from "../src/simulation/tile";

function createStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function initialBoard(puzzleId: "first-shift" | "sand-fall" = "first-shift"): string {
  return serializeBoard(puzzleById(puzzleId).createInitialWorld(), 0);
}

describe("puzzle solutions", () => {
  it("starts empty when no solutions have been stored", () => {
    const solutions = loadPuzzleSolutions(createStorage());

    expect(solutions.forPuzzle("first-shift")).toEqual([]);
  });

  it("creates, duplicates, updates, deletes, and persists independent solutions", () => {
    const storage = createStorage();
    const solutions = PuzzleSolutions.empty();
    const first = solutions.create("first-shift", initialBoard());
    solutions.recordTestResult(first.id, initialBoard(), {
      price: 1,
      cycles: 2,
      footprint: 3,
      combined: 6,
    });
    const second = solutions.create("first-shift", initialBoard());
    const sandFall = solutions.create("sand-fall", initialBoard("sand-fall"));
    const duplicate = solutions.duplicate(first.id);

    expect([first.name, second.name, sandFall.name, duplicate.name]).toEqual([
      "Solution 1",
      "Solution 2",
      "Solution 1",
      "Solution 1 Copy",
    ]);
    expect(duplicate.scores).toEqual({
      price: 1,
      cycles: 2,
      footprint: 3,
      combined: 6,
    });

    const editedWorld = puzzleById("first-shift").createInitialWorld();
    editedWorld.place(8, 2, TileKind.Stone);
    const editedBoard = serializeBoard(editedWorld, 0);
    solutions.updateBoard(duplicate.id, editedBoard);
    solutions.delete(second.id);
    savePuzzleSolutions(storage, solutions);

    const loaded = loadPuzzleSolutions(storage);
    expect(loaded.forPuzzle("first-shift").map(({ id, name }) => ({ id, name }))).toEqual([
      { id: first.id, name: "Solution 1" },
      { id: duplicate.id, name: "Solution 1 Copy" },
    ]);
    expect(loaded.byId(first.id).scores).toEqual({
      price: 1,
      cycles: 2,
      footprint: 3,
      combined: 6,
    });
    expect(loaded.byId(duplicate.id).scores).toBeNull();
    expect(loaded.byId(duplicate.id).board).toBe(editedBoard);
    expect(loaded.forPuzzle("sand-fall")).toHaveLength(1);
    expect(storage.getItem(PUZZLE_SOLUTIONS_STORAGE_KEY)).toBe(solutions.serialize());
  });

  it("keeps generated IDs unique after loading", () => {
    const storage = createStorage();
    const board = initialBoard();
    storage.setItem(
      PUZZLE_SOLUTIONS_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        nextSolutionId: 1,
        solutions: [{
          id: "solution-1",
          puzzleId: "first-shift",
          name: "Solution 1",
          board,
          scores: null,
        }],
      }),
    );

    const created = loadPuzzleSolutions(storage).create("first-shift", board);

    expect(created.id).toBe("solution-2");
    expect(created.name).toBe("Solution 2");
  });

  it.each([
    "not JSON",
    "[]",
    '{"version":1,"nextSolutionId":1,"solutions":[]}',
    '{"version":2,"nextSolutionId":0,"solutions":[]}',
    '{"version":2,"nextSolutionId":1,"solutions":"invalid"}',
    '{"version":2,"nextSolutionId":1,"solutions":[{"id":"one","puzzleId":"missing","name":"Solution 1","board":"invalid","scores":null}]}',
    `{"version":2,"nextSolutionId":1,"solutions":[{"id":"one","puzzleId":"first-shift","name":"Solution 1","board":${JSON.stringify(initialBoard())},"scores":{"price":1,"cycles":2,"footprint":3,"combined":7}}]}`,
  ])("rejects malformed stored solutions: %s", (serialized) => {
    const storage = createStorage();
    storage.setItem(PUZZLE_SOLUTIONS_STORAGE_KEY, serialized);

    expect(() => loadPuzzleSolutions(storage)).toThrow(/Stored/);
  });
});
