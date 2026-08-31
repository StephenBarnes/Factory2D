import { describe, expect, it } from "vitest";

import { PuzzleComponents } from "../src/game/puzzle-components";
import {
  createSandboxWorld,
  isPuzzleUnlocked,
  PUZZLES,
  puzzleById,
  type PuzzleId,
} from "../src/game/puzzles";
import { TileKind } from "../src/simulation/tile";
import { expectDefined } from "../src/util/assert";

describe("puzzle definitions", () => {
  it("unlocks puzzles only after all declared prerequisites are complete", () => {
    for (const puzzle of PUZZLES) {
      const completed = new Set<PuzzleId>(puzzle.prerequisitePuzzleIds);
      expect(isPuzzleUnlocked(puzzle, completed)).toBe(true);

      for (const prerequisiteId of puzzle.prerequisitePuzzleIds) {
        completed.delete(prerequisiteId);
        expect(isPuzzleUnlocked(puzzle, completed)).toBe(false);
        completed.add(prerequisiteId);
      }
    }
  });

  it("keeps registry order and identifier lookup aligned", () => {
    expect(PUZZLES.map((puzzle) => puzzleById(puzzle.id))).toEqual(PUZZLES);
  });

  it("looks up zero-priced components without treating them as unavailable", () => {
    const components = new PuzzleComponents([
      { kind: TileKind.Stone, price: 0 },
      { kind: TileKind.Conveyor, price: 7 },
    ]);

    expect(components.has(TileKind.Stone)).toBe(true);
    expect(components.priceOf(TileKind.Stone)).toBe(0);
    expect(components.has(TileKind.Sand)).toBe(false);
    expect(components.priceOf(TileKind.Sand)).toBeNull();
  });

  it("rejects invalid puzzle component lists", () => {
    expect(() => new PuzzleComponents([])).toThrow("at least one component");
    expect(() => new PuzzleComponents([
      { kind: TileKind.Empty, price: 0 },
    ])).toThrow("cannot be a puzzle component");
    expect(() => new PuzzleComponents([
      { kind: TileKind.Stone, price: -1 },
    ])).toThrow("non-negative safe integer");
    expect(() => new PuzzleComponents([
      { kind: TileKind.Stone, price: 1 },
      { kind: TileKind.Stone, price: 2 },
    ])).toThrow("listed more than once");
  });


  it("creates independent initial worlds", () => {
    const puzzle = expectDefined(PUZZLES[0], "Missing shipped puzzle");
    const first = puzzle.createInitialWorld();
    const second = puzzle.createInitialWorld();
    const originalKind = second.kindAt(0, 0);
    const changedKind = originalKind === TileKind.Empty
      ? TileKind.Stone
      : TileKind.Empty;

    first.place(0, 0, changedKind);

    expect(first.kindAt(0, 0)).toBe(changedKind);
    expect(second.kindAt(0, 0)).toBe(originalKind);
  });

  it("keeps every editable region inside its puzzle board", () => {
    for (const puzzle of PUZZLES) {
      const world = puzzle.createInitialWorld();

      expect(puzzle.editableRegion.fitsWithin(world.width, world.height)).toBe(true);
    }
  });

  it("creates the sandbox through the shared world factory", () => {
    const sandbox = createSandboxWorld();

    expect(sandbox.width).toBe(20);
    expect(sandbox.height).toBe(14);
    expect(sandbox.kindAt(0, sandbox.height - 1)).toBe(TileKind.Platform);
  });
});
