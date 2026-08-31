import { describe, expect, it } from "vitest";

import { GridRegion } from "../src/game/grid-region";
import { PuzzleComponents } from "../src/game/puzzle-components";
import { computePuzzleScores } from "../src/game/puzzle-scores";
import type { PuzzleDefinition } from "../src/game/puzzles";
import { TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function scoringPuzzle(): PuzzleDefinition {
  return {
    id: "score-test",
    name: "Score Test",
    cycleLimit: 20,
    description: "Score calculation test",
    features: [],
    goal: "Calculate scores",
    editableRegion: new GridRegion([
      { x: 1, y: 1, width: 2, height: 2 },
      { x: 4, y: 3, width: 1, height: 1 },
    ]),
    availableComponents: new PuzzleComponents([
      { kind: TileKind.FixedCharge, price: 3 },
      { kind: TileKind.Stone, price: 7 },
    ]),
    prerequisitePuzzleIds: [],
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

    expect(computePuzzleScores(puzzle, solution, 8)).toEqual({
      price: 10,
      cycles: 8,
      footprint: 12,
      combined: 30,
    });
  });

  it("gives an empty editable design zero price and footprint", () => {
    expect(computePuzzleScores(scoringPuzzle(), new World(6, 5), 2)).toEqual({
      price: 0,
      cycles: 2,
      footprint: 0,
      combined: 2,
    });
  });
});
