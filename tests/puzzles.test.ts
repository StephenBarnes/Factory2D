import { describe, expect, it } from "vitest";

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

  it("creates independent initial worlds", () => {
    const first = puzzleById("first-shift").createInitialWorld();
    const second = puzzleById("first-shift").createInitialWorld();

    first.place(0, 0, TileKind.Stone);

    expect(first.kindAt(0, 0)).toBe(TileKind.Stone);
    expect(second.kindAt(0, 0)).toBe(TileKind.Empty);
  });

  it("creates the sandbox through the shared world factory", () => {
    const sandbox = createSandboxWorld();

    expect(sandbox.width).toBe(20);
    expect(sandbox.height).toBe(14);
    expect(sandbox.kindAt(0, sandbox.height - 1)).toBe(TileKind.Platform);
  });
});
