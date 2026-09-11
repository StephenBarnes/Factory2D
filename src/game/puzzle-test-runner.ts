import { applyEditableSolution } from "./editable-solution";
import type { GridRegion } from "./grid-region";
import {
  MAX_PUZZLE_CYCLE_LIMIT,
} from "./puzzle-format";
import type { PuzzleDefinition, PuzzleTestCaseDefinition } from "./puzzles";
import { computePuzzleScores, type PuzzleScores } from "./puzzle-scores";
import { PuzzleResult } from "../simulation/puzzle-result";
import { Simulation } from "../simulation/simulation";
import type { World } from "../simulation/world";
import { expectDefined } from "../util/assert";

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
  readonly scores: PuzzleScores | null;
}

export type PuzzleTestRunStatus =
  | "running"
  | "between-cases"
  | "failed"
  | "succeeded";

/** Incremental puzzle verification whose live world can be rendered by the workshop. */
export class PuzzleTestRun {
  private readonly solution: World;
  private readonly results: PuzzleTestCaseResult[] = [];
  private caseIndex = 0;
  private currentSimulationValue: Simulation;
  private statusValue: PuzzleTestRunStatus = "running";
  private reportValue: PuzzleTestReport | null = null;

  constructor(
    private readonly puzzle: PuzzleDefinition,
    solution: World,
  ) {
    if (puzzle.testCases.length === 0) {
      throw new Error(`Puzzle "${puzzle.id}" has no test cases`);
    }
    this.solution = solution.clone();
    this.currentSimulationValue = this.createCurrentSimulation();
  }

  get status(): PuzzleTestRunStatus {
    return this.statusValue;
  }

  get currentCase(): PuzzleTestCaseDefinition {
    return expectDefined(
      this.puzzle.testCases[this.caseIndex],
      `Puzzle "${this.puzzle.id}" test case ${this.caseIndex}`,
    );
  }

  get world(): World {
    return this.currentSimulationValue.world;
  }

  get simulation(): Simulation {
    return this.currentSimulationValue;
  }

  get report(): PuzzleTestReport | null {
    return this.reportValue;
  }

  step(interpolationSource?: World): PuzzleTestRunStatus {
    if (this.statusValue !== "running") {
      throw new Error(`Cannot step puzzle tests while ${this.statusValue}`);
    }

    this.currentSimulationValue.step(interpolationSource);
    const testCase = this.currentCase;
    if (
      this.world.puzzleResult === PuzzleResult.InProgress &&
      this.currentSimulationValue.tick < testCase.cycleLimit
    ) {
      return this.statusValue;
    }

    const outcome = this.world.puzzleResult === PuzzleResult.Won
      ? "won"
      : this.world.puzzleResult === PuzzleResult.Lost ? "lost" : "cycle-limit";
    this.results.push(Object.freeze({
      id: testCase.id,
      name: testCase.name,
      outcome,
      cycles: this.currentSimulationValue.tick,
      cycleLimit: testCase.cycleLimit,
    }));

    if (outcome !== "won") {
      this.finish(false);
    } else if (this.caseIndex === this.puzzle.testCases.length - 1) {
      this.finish(true);
    } else {
      this.statusValue = "between-cases";
    }
    return this.statusValue;
  }

  continueToNextCase(): void {
    if (this.statusValue !== "between-cases") {
      throw new Error(`Cannot continue puzzle tests while ${this.statusValue}`);
    }
    this.caseIndex += 1;
    this.currentSimulationValue = this.createCurrentSimulation();
    this.statusValue = "running";
  }

  runRemaining(afterStep?: (world: World, tick: number) => void): PuzzleTestReport {
    while (this.statusValue === "running" || this.statusValue === "between-cases") {
      if (this.statusValue === "between-cases") {
        this.continueToNextCase();
      } else {
        this.step();
        afterStep?.(this.world, this.currentSimulationValue.tick);
      }
    }
    return expectDefined(this.reportValue ?? undefined, "Completed puzzle test report");
  }

  private createCurrentSimulation(): Simulation {
    return new Simulation(createPuzzleTestCaseWorld(
      this.currentCase,
      this.puzzle.editableRegion,
      this.solution,
    ));
  }

  private finish(succeeded: boolean): void {
    this.statusValue = succeeded ? "succeeded" : "failed";
    const frozenResults = Object.freeze(this.results.slice());
    const scores = succeeded
      ? computePuzzleScores(
        this.puzzle,
        this.solution,
        frozenResults.reduce((cycles, result) => cycles + result.cycles, 0) / frozenResults.length,
      )
      : null;
    this.reportValue = Object.freeze({ succeeded, results: frozenResults, scores });
  }
}

/** Runs puzzle cases without rendering, stopping at the first failed case. */
export function runPuzzleTests(
  puzzle: PuzzleDefinition,
  solution: World,
): PuzzleTestReport {
  return new PuzzleTestRun(puzzle, solution).runRemaining();
}

export function createPuzzleTestCaseWorld(
  testCase: PuzzleTestCaseDefinition,
  editableRegion: GridRegion,
  solution: World,
): World {
  validateCycleLimit(testCase);
  const world = testCase.createInitialWorld();
  applyEditableSolution(world, solution, editableRegion);
  return world;
}

function validateCycleLimit(testCase: PuzzleTestCaseDefinition): void {
  if (
    !Number.isSafeInteger(testCase.cycleLimit) ||
    testCase.cycleLimit < 1 ||
    testCase.cycleLimit > MAX_PUZZLE_CYCLE_LIMIT
  ) {
    throw new RangeError(
      `Puzzle test case "${testCase.id}" cycle limit must be from 1 through ${MAX_PUZZLE_CYCLE_LIMIT}`,
    );
  }
}
