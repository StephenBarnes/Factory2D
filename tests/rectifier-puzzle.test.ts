import { describe, expect, it } from "vitest";

import { runPuzzleTests } from "../src/game/puzzle-test-runner";
import { puzzleById } from "../src/game/puzzles";
import { SignalTraceRecorder } from "../src/game/signal-traces";
import { Direction, TileKind } from "../src/simulation/tile";
import type { World } from "../src/simulation/world";

function weld(world: World, a: readonly [number, number], b: readonly [number, number]): void {
  if (!world.setWeld(a[0], a[1], b[0], b[1], true)) {
    throw new Error(`Weld (${a.join(",")}) - (${b.join(",")}) rejected`);
  }
}

/** sign(x + x·x): a multiplier squares the input while a combiner buffers it, then a combiner sums both. */
function placeReferenceSolution(world: World): void {
  world.place(8, 9, TileKind.Conduit);
  world.place(9, 9, TileKind.Conduit);
  world.place(9, 8, TileKind.Conduit);
  world.place(10, 8, TileKind.Conduit);
  world.place(10, 9, TileKind.Multiplier, Direction.Right);
  world.place(8, 10, TileKind.Conduit);
  world.place(9, 10, TileKind.Combiner, Direction.Right);
  world.place(10, 10, TileKind.Conduit);
  world.place(11, 10, TileKind.Conduit);
  world.place(11, 9, TileKind.Combiner, Direction.Right);
  world.place(12, 9, TileKind.Conduit);
  world.place(13, 9, TileKind.Conduit);
  weld(world, [7, 9], [8, 9]);
  weld(world, [8, 9], [9, 9]);
  weld(world, [9, 9], [10, 9]);
  weld(world, [9, 9], [9, 8]);
  weld(world, [9, 8], [10, 8]);
  weld(world, [10, 8], [10, 9]);
  weld(world, [8, 9], [8, 10]);
  weld(world, [8, 10], [9, 10]);
  weld(world, [9, 10], [10, 10]);
  weld(world, [10, 10], [11, 10]);
  weld(world, [11, 10], [11, 9]);
  weld(world, [10, 9], [11, 9]);
  weld(world, [11, 9], [12, 9]);
  weld(world, [12, 9], [13, 9]);
  weld(world, [13, 9], [14, 9]);
}

function placePassthroughSolution(world: World): void {
  for (let x = 8; x <= 13; x += 1) {
    world.place(x, 9, TileKind.Conduit);
    weld(world, [x - 1, 9], [x, 9]);
  }
  weld(world, [13, 9], [14, 9]);
}

describe("shipped rectifier puzzle", () => {
  it("accepts the reference two-tick rectifier in every test case", () => {
    const puzzle = puzzleById("rectifier");
    const solution = puzzle.createInitialWorld();
    placeReferenceSolution(solution);

    const report = runPuzzleTests(puzzle, solution);

    expect(report.succeeded).toBe(true);
    expect(report.results.map((result) => [result.id, result.outcome, result.cycles])).toEqual([
      ["mixed", "won", 30],
      ["bursts", "won", 30],
    ]);
  });

  it("rejects a passthrough at the first negative input", () => {
    const puzzle = puzzleById("rectifier");
    const solution = puzzle.createInitialWorld();
    placePassthroughSolution(solution);

    const report = runPuzzleTests(puzzle, solution);

    expect(report.succeeded).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ id: "mixed", outcome: "lost" });
  });

  it("orders its signal panel lines as input, output, then expected", () => {
    const puzzle = puzzleById("rectifier");
    const world = puzzle.createInitialWorld();
    const recorder = new SignalTraceRecorder();
    recorder.sync(world, 0);

    const lines = recorder.lines(world);
    expect(lines.map((line) => [line.kind, line.label])).toEqual([
      ["monitor", "INPUT"],
      ["monitor", "OUTPUT"],
      ["grapher", "EXPECTED"],
    ]);
    const expected = lines[2];
    expect(expected?.kind === "grapher" ? expected.values.slice(0, 6) : null).toEqual([
      0, 0, 0, 1, 0, 0,
    ]);
  });
});
