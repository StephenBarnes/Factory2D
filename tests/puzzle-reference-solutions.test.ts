import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { runPuzzleTests } from "../src/game/puzzle-test-runner";
import { puzzleById } from "../src/game/puzzles";
import { deserializeBoard } from "../src/simulation/board-export";
import { PuzzleResult } from "../src/simulation/puzzle-result";

const fixtureDirectory = new URL("./fixtures/puzzle-solutions/", import.meta.url);
const fixtureNames = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith(".json"))
  .sort();

// Fixtures are optional, but every saved solution must solve a current shipped puzzle.
describe("shipped puzzle reference solutions", () => {
  it.each(fixtureNames)("%s remains solvable in every test case", (fileName) => {
    const puzzle = puzzleById(fileName.slice(0, -".json".length));
    const source = readFileSync(
      new URL(fileName, fixtureDirectory),
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
