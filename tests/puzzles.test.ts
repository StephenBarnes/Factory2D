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

describe("puzzle definitions", () => {
  it("unlocks puzzles only after all prerequisite puzzles are complete", () => {
    const completed = new Set<PuzzleId>();

    expect(isPuzzleUnlocked(puzzleById("first-shift"), completed)).toBe(true);
    expect(isPuzzleUnlocked(puzzleById("beltworks"), completed)).toBe(false);
    expect(isPuzzleUnlocked(puzzleById("runic-relay"), completed)).toBe(false);

    completed.add("first-shift");
    expect(isPuzzleUnlocked(puzzleById("beltworks"), completed)).toBe(true);
    expect(isPuzzleUnlocked(puzzleById("runic-relay"), completed)).toBe(false);

    completed.add("beltworks");
    expect(isPuzzleUnlocked(puzzleById("runic-relay"), completed)).toBe(true);
  });

  it("keeps registry order and identifier lookup aligned", () => {
    expect(PUZZLES.map((puzzle) => puzzleById(puzzle.id))).toEqual(PUZZLES);
  });
  it("assigns each workshop an explicit priced component set", () => {
    expect(puzzleById("first-shift").availableComponents.entries).toEqual([
      { kind: TileKind.Stone, price: 1 },
      { kind: TileKind.Platform, price: 3 },
    ]);
    expect(puzzleById("beltworks").availableComponents.entries).toEqual([
      { kind: TileKind.Stone, price: 1 },
      { kind: TileKind.Platform, price: 3 },
      { kind: TileKind.Conveyor, price: 5 },
      { kind: TileKind.Conduit, price: 1 },
      { kind: TileKind.FixedCharge, price: 2 },
    ]);
    expect(puzzleById("runic-relay").availableComponents.entries).toEqual([
      { kind: TileKind.Conduit, price: 1 },
      { kind: TileKind.FixedCharge, price: 2 },
      { kind: TileKind.Spark, price: 3 },
      { kind: TileKind.Inverter, price: 4 },
      { kind: TileKind.Combiner, price: 4 },
      { kind: TileKind.WireCrossing, price: 3 },
    ]);
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
    const first = puzzleById("first-shift").createInitialWorld();
    const second = puzzleById("first-shift").createInitialWorld();

    first.place(0, 0, TileKind.Stone);

    expect(first.kindAt(0, 0)).toBe(TileKind.Stone);
    expect(second.kindAt(0, 0)).toBe(TileKind.Empty);
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
