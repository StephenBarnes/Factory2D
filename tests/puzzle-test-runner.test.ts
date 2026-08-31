import { describe, expect, it } from "vitest";

import { GridRegion } from "../src/game/grid-region";
import { PuzzleComponents } from "../src/game/puzzle-components";
import { runPuzzleTests } from "../src/game/puzzle-test-runner";
import type {
  PuzzleDefinition,
  PuzzleTestCaseDefinition,
} from "../src/game/puzzles";
import { PuzzleResult } from "../src/simulation/puzzle-result";
import { TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function puzzleWith(testCases: readonly PuzzleTestCaseDefinition[]): PuzzleDefinition {
  return {
    id: "runner-test",
    name: "Runner Test",
    cycleLimit: 20,
    description: "Runner test puzzle",
    features: [],
    goal: "Trigger victory",
    editableRegion: new GridRegion([{ x: 0, y: 0, width: 1, height: 1 }]),
    availableComponents: new PuzzleComponents([{ kind: TileKind.FixedCharge, price: 1 }]),
    prerequisitePuzzleIds: [],
    createInitialWorld: () => testCases[0]?.createInitialWorld() ?? new World(2, 1),
    testCases,
  };
}

function caseDefinition(
  id: string,
  cycleLimit: number,
  createInitialWorld: () => World,
): PuzzleTestCaseDefinition {
  return { id, name: `Case ${id}`, cycleLimit, createInitialWorld };
}

function emptyVictoryWorld(): World {
  const world = new World(2, 1);
  world.place(1, 0, TileKind.Victory);
  return world;
}

function chargedVictoryWorld(charge: -1 | 1): World {
  const world = new World(3, 1);
  world.place(1, 0, TileKind.Conduit);
  world.place(2, 0, TileKind.Victory);
  world.setWeld(1, 0, 2, 0, true);
  world.setCharge(1, 0, charge);
  return world;
}

describe("puzzle test runner", () => {
  it("applies editable cells and perimeter welds to every isolated test world", () => {
    const solution = emptyVictoryWorld();
    solution.place(0, 0, TileKind.FixedCharge);
    solution.setWeld(0, 0, 1, 0, true);
    const puzzle = puzzleWith([
      caseDefinition("first", 5, emptyVictoryWorld),
      caseDefinition("second", 5, emptyVictoryWorld),
    ]);

    const report = runPuzzleTests(puzzle, solution);

    expect(report.succeeded).toBe(true);
    expect(report.results.map((result) => result.outcome)).toEqual(["won", "won"]);
    expect(report.results.map((result) => result.cycles)).toEqual([2, 2]);
    expect(solution.puzzleResult).toBe(PuzzleResult.InProgress);
    expect(solution.kindAt(0, 0)).toBe(TileKind.FixedCharge);
  });

  it("runs later cases after a failure and requires every case to win", () => {
    const solution = new World(3, 1);
    const puzzle = puzzleWith([
      caseDefinition("loss", 5, () => chargedVictoryWorld(-1)),
      caseDefinition("win", 5, () => chargedVictoryWorld(1)),
    ]);

    const report = runPuzzleTests(puzzle, solution);

    expect(report.succeeded).toBe(false);
    expect(report.results.map((result) => [result.id, result.outcome])).toEqual([
      ["loss", "lost"],
      ["win", "won"],
    ]);
  });

  it("reports the exact cycle limit when a case never reaches victory", () => {
    const solution = emptyVictoryWorld();
    const puzzle = puzzleWith([
      caseDefinition("timeout", 3, emptyVictoryWorld),
    ]);

    const report = runPuzzleTests(puzzle, solution);

    expect(report).toMatchObject({
      succeeded: false,
      results: [{
        id: "timeout",
        outcome: "cycle-limit",
        cycles: 3,
        cycleLimit: 3,
      }],
    });
  });
});
