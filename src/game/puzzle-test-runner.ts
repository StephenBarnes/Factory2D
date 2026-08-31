import type { GridRegion } from "./grid-region";
import {
  MAX_PUZZLE_CYCLE_LIMIT,
} from "./puzzle-format";
import type { PuzzleDefinition, PuzzleTestCaseDefinition } from "./puzzles";
import { PuzzleResult } from "../simulation/puzzle-result";
import { Simulation } from "../simulation/simulation";
import type { World } from "../simulation/world";

export type PuzzleTestOutcome = "won" | "lost" | "cycle-limit";

export interface PuzzleTestCaseResult {
  readonly id: string;
  readonly name: string;
  readonly outcome: PuzzleTestOutcome;
  readonly cycles: number;
  readonly cycleLimit: number;
}

export interface PuzzleTestReport {
  readonly succeeded: boolean;
  readonly results: readonly PuzzleTestCaseResult[];
}

/** Runs every puzzle case against an isolated copy of the editable solution. */
export function runPuzzleTests(
  puzzle: PuzzleDefinition,
  solution: World,
): PuzzleTestReport {
  if (puzzle.testCases.length === 0) {
    throw new Error(`Puzzle "${puzzle.id}" has no test cases`);
  }

  const results: PuzzleTestCaseResult[] = [];
  let succeeded = true;
  for (const testCase of puzzle.testCases) {
    const result = runPuzzleTestCase(testCase, puzzle.editableRegion, solution);
    results.push(result);
    succeeded = result.outcome === "won" && succeeded;
  }
  return Object.freeze({ succeeded, results: Object.freeze(results) });
}

function runPuzzleTestCase(
  testCase: PuzzleTestCaseDefinition,
  editableRegion: GridRegion,
  solution: World,
): PuzzleTestCaseResult {
  if (
    !Number.isSafeInteger(testCase.cycleLimit) ||
    testCase.cycleLimit < 1 ||
    testCase.cycleLimit > MAX_PUZZLE_CYCLE_LIMIT
  ) {
    throw new RangeError(
      `Puzzle test case "${testCase.id}" cycle limit must be from 1 through ${MAX_PUZZLE_CYCLE_LIMIT}`,
    );
  }

  const world = testCase.createInitialWorld();
  applyEditableSolution(world, solution, editableRegion);
  const simulation = new Simulation(world);
  while (
    simulation.tick < testCase.cycleLimit &&
    world.puzzleResult === PuzzleResult.InProgress
  ) {
    simulation.step();
  }

  const outcome = world.puzzleResult === PuzzleResult.Won
    ? "won"
    : world.puzzleResult === PuzzleResult.Lost ? "lost" : "cycle-limit";
  return Object.freeze({
    id: testCase.id,
    name: testCase.name,
    outcome,
    cycles: simulation.tick,
    cycleLimit: testCase.cycleLimit,
  });
}

function applyEditableSolution(
  target: World,
  solution: World,
  editableRegion: GridRegion,
): void {
  if (target.width !== solution.width || target.height !== solution.height) {
    throw new RangeError("Puzzle test world dimensions must match the solution");
  }

  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      if (editableRegion.contains(x, y)) {
        target.place(x, y, solution.kindAt(x, y), solution.orientationAt(x, y));
      }
    }
  }

  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width - 1; x += 1) {
      if (editableRegion.containsEdge(x, y, x + 1, y)) {
        target.setWeld(x, y, x + 1, y, solution.isWelded(x, y, x + 1, y));
      }
    }
  }
  for (let y = 0; y < target.height - 1; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      if (editableRegion.containsEdge(x, y, x, y + 1)) {
        target.setWeld(x, y, x, y + 1, solution.isWelded(x, y, x, y + 1));
      }
    }
  }
}
