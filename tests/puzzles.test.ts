import { describe, expect, it } from "vitest";

import { GridRegion } from "../src/game/grid-region";
import { puzzleGroupById } from "../src/game/puzzle-groups";

import { PuzzleComponents } from "../src/game/puzzle-components";
import {
  createSandboxWorld,
  isPuzzleGroupUnlocked,
  isPuzzleUnlocked,
  PUZZLES,
  puzzleById,
  type PuzzleDefinition,
  type PuzzleId,
} from "../src/game/puzzles";
import { TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";
import { expectDefined } from "../src/util/assert";

function progressionPuzzle(id: string, order: number): PuzzleDefinition {
  return {
    id,
    groupId: "basics",
    order,
    name: id,
    cycleLimit: 10,
    description: id,
    goal: id,
    editableRegion: new GridRegion([{ x: 0, y: 0, width: 1, height: 1 }]),
    availableComponents: new PuzzleComponents([{ kind: TileKind.Stone, price: 1 }]),
    createInitialWorld: () => new World(1, 1),
    testCases: [],
  };
}

describe("puzzle definitions", () => {
  it("unlocks groups at their gemstone thresholds", () => {
    const runelore = expectDefined(puzzleGroupById("runelore"), "Missing Runelore group");
    expect(isPuzzleGroupUnlocked(runelore, new Set())).toBe(false);
    expect(isPuzzleGroupUnlocked(
      runelore,
      new Set<PuzzleId>(["first-shift", "sand-fall"]),
    )).toBe(true);
  });

  it("uses the group's initial count and unlocks one more puzzle per completion", () => {
    const puzzles = Array.from(
      { length: 6 },
      (_, index) => progressionPuzzle(`sequence-${index}`, index),
    );
    const completed = new Set<PuzzleId>();
    expect(puzzles.map((puzzle) => isPuzzleUnlocked(puzzle, completed, puzzles))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);

    completed.add("sequence-0");
    expect(puzzles.map((puzzle) => isPuzzleUnlocked(puzzle, completed, puzzles))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
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
