import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { runPuzzleTests } from "../src/game/puzzle-test-runner";
import { PUZZLES } from "../src/game/puzzles";
import { deserializeBoard } from "../src/simulation/board-export";
import { PuzzleResult } from "../src/simulation/puzzle-result";

// Iterate the registry, not the fixture directory: every new shipped puzzle must have a solution.
describe("shipped puzzle reference solutions", () => {
  it.each(PUZZLES)("$id remains solvable in every test case", (puzzle) => {
    const source = readFileSync(
      new URL(`./fixtures/puzzle-solutions/${puzzle.id}.json`, import.meta.url),
      "utf8",
    );
    const { world, tick } = deserializeBoard(source);
    expect(tick).toBe(0);
    expect(world.puzzleResult).toBe(PuzzleResult.InProgress);

    // Rebuild fixed machinery from the current puzzle, applying only permitted solution edits.
    const report = runPuzzleTests(puzzle, world);
    expect(report.results.map(({ id, outcome }) => ({ id, outcome }))).toEqual(
      puzzle.testCases.map(({ id }) => ({ id, outcome: "won" })),
    );
    expect(report.succeeded).toBe(true);
  });
});
