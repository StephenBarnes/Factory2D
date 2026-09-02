import { describe, expect, it } from "vitest";

import { runPuzzleTests } from "../src/game/puzzle-test-runner";
import { puzzleById } from "../src/game/puzzles";
import { SignalTraceRecorder } from "../src/game/signal-traces";
import { Direction, TileKind } from "../src/simulation/tile";
import type { World } from "../src/simulation/world";

/** Cycles the checker needs after the player's first output for the mixed and burst cases. */
const MIXED_CYCLES_AT_ZERO_LATENCY = 29;
const BURSTS_CYCLES_AT_ZERO_LATENCY = 32;

function weld(world: World, a: readonly [number, number], b: readonly [number, number]): void {
  if (!world.setWeld(a[0], a[1], b[0], b[1], true) && !world.isWelded(a[0], a[1], b[0], b[1])) {
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

/**
 * Serpentine tail from the reference solution's output at (11, 9) to the monitor at (14, 9).
 * The first `combinerCount` cells are combiners facing the next cell, each adding one tick of
 * latency; the rest are conduits.
 */
const TAIL_PATH: readonly (readonly [number, number])[] = [
  [12, 9], [12, 8], [12, 7], [12, 6], [13, 6], [13, 7], [13, 8], [13, 9],
];

function placeReferenceWithLatencyTail(world: World, combinerCount: number): void {
  placeReferenceSolution(world);
  for (let step = 0; step < TAIL_PATH.length; step += 1) {
    const [x, y] = TAIL_PATH[step] ?? [0, 0];
    const [nextX, nextY] = TAIL_PATH[step + 1] ?? [14, 9];
    if (step < combinerCount) {
      const direction = nextX > x
        ? Direction.Right
        : nextY < y
          ? Direction.Up
          : Direction.Down;
      world.place(x, y, TileKind.Combiner, direction);
    } else {
      world.place(x, y, TileKind.Conduit);
    }
  }
  weld(world, [11, 9], [12, 9]);
  for (let step = 0; step + 1 < TAIL_PATH.length; step += 1) {
    weld(world, TAIL_PATH[step] ?? [0, 0], TAIL_PATH[step + 1] ?? [0, 0]);
  }
  weld(world, [13, 9], [14, 9]);
}

function placePassthroughSolution(world: World): void {
  for (let x = 8; x <= 13; x += 1) {
    world.place(x, 9, TileKind.Conduit);
    weld(world, [x - 1, 9], [x, 9]);
  }
  weld(world, [13, 9], [14, 9]);
}

/** Squares the input, so negative inputs also produce +1. */
function placeAbsoluteValueSolution(world: World): void {
  world.place(8, 9, TileKind.Conduit);
  world.place(9, 9, TileKind.Conduit);
  world.place(9, 8, TileKind.Conduit);
  world.place(10, 8, TileKind.Conduit);
  world.place(10, 9, TileKind.Multiplier, Direction.Right);
  world.place(11, 9, TileKind.Conduit);
  world.place(12, 9, TileKind.Conduit);
  world.place(13, 9, TileKind.Conduit);
  weld(world, [7, 9], [8, 9]);
  weld(world, [8, 9], [9, 9]);
  weld(world, [9, 9], [10, 9]);
  weld(world, [9, 9], [9, 8]);
  weld(world, [9, 8], [10, 8]);
  weld(world, [10, 8], [10, 9]);
  weld(world, [10, 9], [11, 9]);
  weld(world, [11, 9], [12, 9]);
  weld(world, [12, 9], [13, 9]);
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
      ["mixed", "won", MIXED_CYCLES_AT_ZERO_LATENCY + 2],
      ["bursts", "won", BURSTS_CYCLES_AT_ZERO_LATENCY + 2],
    ]);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
    "accepts a correct rectifier with %i extra ticks of latency",
    (combinerCount) => {
    const latency = 2 + combinerCount;
    const puzzle = puzzleById("rectifier");
    const solution = puzzle.createInitialWorld();
    placeReferenceWithLatencyTail(solution, combinerCount);

    const report = runPuzzleTests(puzzle, solution);

    expect(report.succeeded).toBe(true);
    expect(report.results.map((result) => [result.id, result.outcome, result.cycles])).toEqual([
      ["mixed", "won", MIXED_CYCLES_AT_ZERO_LATENCY + latency],
      ["bursts", "won", BURSTS_CYCLES_AT_ZERO_LATENCY + latency],
    ]);
    },
  );

  it("rejects a passthrough at the first negative input", () => {
    const puzzle = puzzleById("rectifier");
    const solution = puzzle.createInitialWorld();
    placePassthroughSolution(solution);

    const report = runPuzzleTests(puzzle, solution);

    expect(report.succeeded).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ id: "mixed", outcome: "lost" });
  });

  it("rejects an absolute-value machine that emits +1 for negative inputs", () => {
    const puzzle = puzzleById("rectifier");
    const solution = puzzle.createInitialWorld();
    placeAbsoluteValueSolution(solution);

    const report = runPuzzleTests(puzzle, solution);

    expect(report.succeeded).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ id: "mixed", outcome: "lost" });
  });

  it("fails on the cycle limit when the workshop never emits a signal", () => {
    const puzzle = puzzleById("rectifier");
    const solution = puzzle.createInitialWorld();

    const report = runPuzzleTests(puzzle, solution);

    expect(report.succeeded).toBe(false);
    expect(report.results[0]).toMatchObject({ id: "mixed", outcome: "cycle-limit" });
  });

  it("orders its signal panel lines as input, output, then the checker's expected sequence", () => {
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
      1, 0, 0, 1, 1, 0,
    ]);
    expect(expected).toMatchObject({ firstRow: 0, cursor: 0 });
  });
});
