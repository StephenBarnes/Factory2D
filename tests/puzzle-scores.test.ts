import { describe, expect, it } from "vitest";

import { GridRegion } from "../src/game/grid-region";
import { PuzzleComponents } from "../src/game/puzzle-components";
import {
  computePuzzleDesignMetrics,
  computePuzzleScores,
  parsePuzzleScores,
} from "../src/game/puzzle-scores";
import type { PuzzleDefinition } from "../src/game/puzzles";
import { TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function scoringPuzzle(): PuzzleDefinition {
  return {
    id: "score-test",
    groupId: "basics",
    order: 0,
    name: "Score Test",
    cycleLimit: 20,
    description: "Score calculation test",
    goal: "Calculate scores",
    editableRegion: new GridRegion([
      { x: 1, y: 1, width: 2, height: 2 },
      { x: 4, y: 3, width: 1, height: 1 },
    ]),
    availableComponents: new PuzzleComponents([
      { kind: TileKind.FixedCharge, price: 3 },
      { kind: TileKind.Stone, price: 7 },
    ]),
    createInitialWorld: () => new World(6, 5),
    testCases: [],
  };
}

describe("puzzle scores", () => {
  it("sums component prices and measures the editable-block bounding box", () => {
    const puzzle = scoringPuzzle();
    const solution = new World(6, 5);
    solution.place(1, 1, TileKind.FixedCharge);
    solution.place(4, 3, TileKind.Stone);
    solution.place(0, 0, TileKind.Stone);

    expect(computePuzzleDesignMetrics(puzzle, solution)).toEqual({
      price: 10,
      footprintWidth: 4,
      footprintHeight: 3,
    });

    expect(computePuzzleScores(puzzle, solution, 8)).toEqual({
      price: 10,
      cycles: 8,
      footprint: 12,
      combined: 30,
    });
  });

  it("charges full price for every component inside a rune array without widening the footprint", () => {
    const puzzle: PuzzleDefinition = {
      ...scoringPuzzle(),
      availableComponents: new PuzzleComponents([
        { kind: TileKind.FixedCharge, price: 3 },
        { kind: TileKind.Stone, price: 7 },
        { kind: TileKind.RuneArray, price: 10 },
      ]),
    };
    const solution = new World(6, 5);
    solution.place(1, 1, TileKind.RuneArray);
    solution.configureRuneArray(1, 1, 3, 3, "");
    const inner = solution.runeArrayWorldAt(1, 1);
    inner.place(0, 2, TileKind.Stone);
    inner.place(1, 2, TileKind.RuneArray);
    inner.runeArrayWorldAt(1, 2).place(2, 4, TileKind.FixedCharge);
    solution.place(0, 0, TileKind.Stone);

    expect(computePuzzleDesignMetrics(puzzle, solution)).toEqual({
      price: 10 + 7 + 10 + 3,
      footprintWidth: 1,
      footprintHeight: 1,
    });
  });

  it("gives an empty editable design zero price and footprint", () => {
    expect(computePuzzleDesignMetrics(scoringPuzzle(), new World(6, 5))).toEqual({
      price: 0,
      footprintWidth: 0,
      footprintHeight: 0,
    });

    expect(computePuzzleScores(scoringPuzzle(), new World(6, 5), 2)).toEqual({
      price: 0,
      cycles: 2,
      footprint: 0,
      combined: 2,
    });
  });

  it("retains fractional cycle and combined scores through JSON validation", () => {
    const scores = computePuzzleScores(scoringPuzzle(), new World(6, 5), 7 / 3);
    expect(scores.cycles).toBe(7 / 3);
    expect(parsePuzzleScores(JSON.parse(JSON.stringify(scores)), "Saved")).toEqual(scores);
  });

  it.each([
    { cycles: NaN },
    { cycles: Infinity },
    { cycles: -1 },
    { cycles: Number.MAX_SAFE_INTEGER + 1 },
    { price: 0.5 },
    { footprint: 0.5 },
    { combined: Infinity },
    { combined: 3 },
  ])("rejects invalid score values %o", (invalid) => {
    expect(() => parsePuzzleScores({
      price: 0, cycles: 1.5, footprint: 0, combined: 1.5, ...invalid,
    }, "Saved")).toThrow();
  });
});
