import { describe, expect, it } from "vitest";

import { GridRegion } from "../src/game/grid-region";
import { PuzzleComponents } from "../src/game/puzzle-components";
import {
  createPuzzleTestCaseWorld,
  PuzzleTestRun,
  runPuzzleTests,
} from "../src/game/puzzle-test-runner";
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
    groupId: "basics",
    order: 0,
    name: "Runner Test",
    cycleLimit: 20,
    description: "Runner test puzzle",
    goal: "Trigger victory",
    editableRegion: new GridRegion([{ x: 0, y: 0, width: 1, height: 1 }]),
    availableComponents: new PuzzleComponents([{ kind: TileKind.FixedCharge, price: 1 }]),
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
    expect(report.scores).toEqual({
      price: 1,
      cycles: 4,
      footprint: 1,
      combined: 6,
    });
    expect(solution.puzzleResult).toBe(PuzzleResult.InProgress);
    expect(solution.kindAt(0, 0)).toBe(TileKind.FixedCharge);
  });

  it("preserves editable configurable-component settings in a case world", () => {
    const solution = emptyVictoryWorld();
    solution.place(0, 0, TileKind.Delay);
    solution.configureNumericComponent(0, 0, 7);
    const testCase = caseDefinition("configured", 5, emptyVictoryWorld);
    const puzzle = puzzleWith([testCase]);

    const testWorld = createPuzzleTestCaseWorld(
      testCase,
      puzzle.editableRegion,
      solution,
    );

    expect(testWorld.componentStateSnapshotAt(0, 0)).toMatchObject({
      type: "delay",
      length: 7,
    });
  });

  it("stops immediately on the first failed case", () => {
    const solution = new World(3, 1);
    const puzzle = puzzleWith([
      caseDefinition("loss", 5, () => chargedVictoryWorld(-1)),
      caseDefinition("win", 5, () => chargedVictoryWorld(1)),
    ]);

    const report = runPuzzleTests(puzzle, solution);

    expect(report.succeeded).toBe(false);
    expect(report.scores).toBeNull();
    expect(report.results.map((result) => [result.id, result.outcome])).toEqual([
      ["loss", "lost"],
    ]);
  });

  it("exposes each live case world and pauses between successful cases", () => {
    const solution = emptyVictoryWorld();
    solution.place(0, 0, TileKind.FixedCharge);
    solution.setWeld(0, 0, 1, 0, true);
    const run = new PuzzleTestRun(puzzleWith([
      caseDefinition("first", 5, emptyVictoryWorld),
      caseDefinition("second", 5, emptyVictoryWorld),
    ]), solution);

    expect(run.currentCase.id).toBe("first");
    expect(run.status).toBe("running");
    expect(run.step()).toBe("running");
    expect(run.step()).toBe("between-cases");
    expect(run.world.puzzleResult).toBe(PuzzleResult.Won);

    run.continueToNextCase();
    expect(run.currentCase.id).toBe("second");
    expect(run.simulation.tick).toBe(0);
    expect(run.runRemaining()).toMatchObject({
      succeeded: true,
      results: [{ id: "first" }, { id: "second" }],
    });
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
