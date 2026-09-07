import { describe, expect, it } from "vitest";

import {
  grapherCursorRow,
  signalLineChargeAtRow,
  signalLineRowCount,
  SignalTraceRecorder,
} from "../src/game/signal-traces";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function createSparkMonitorWorld(): World {
  const world = new World(3, 1);
  world.place(0, 0, TileKind.Spark);
  world.place(1, 0, TileKind.Monitor);
  world.setWeld(0, 0, 1, 0, true);
  return world;
}

describe("signal monitors", () => {
  it("keeps recursive histories separate across overlapping IDs and moving arrays", () => {
    const world = new World(3, 2);
    world.place(0, 0, TileKind.RuneArray);
    world.place(1, 0, TileKind.RuneArray);
    const left = world.runeArrayWorldAt(0, 0);
    const right = world.runeArrayWorldAt(1, 0);
    left.place(3, 4, TileKind.RuneArray);
    const deep = left.runeArrayWorldAt(3, 4);
    for (const [board, source] of [
      [left, TileKind.Spark], [right, TileKind.FixedCharge], [deep, TileKind.FixedCharge],
    ] as const) {
      board.place(0, 4, TileKind.Monitor);
      board.place(1, 4, source);
      board.setWeld(0, 4, 1, 4, true);
      board.configureSignalLabel(0, 4, "OUT");
    }
    expect(right.idAt(0, 4)).toBe(deep.idAt(0, 4));
    const recorder = new SignalTraceRecorder();
    const simulation = new Simulation(world);
    recorder.sync(world, 0);
    for (let tick = 1; tick <= 2; tick += 1) {
      simulation.step();
      recorder.sync(world, tick);
    }
    expect(world.kindAt(0, 1)).toBe(TileKind.RuneArray);
    const lines = recorder.lines(world);
    expect(lines.map((line) => line.kind === "monitor" ? line.charges : [])).toEqual([
      [0, 1, 0], [0, 1, 1], [0, 1, 1],
    ]);
    expect(new Set(lines.map((line) => line.label)).size).toBe(3);
    expect(lines.map((line) => line.world)).toEqual([left, deep, right]);
  });

  it("refreshes nested-only edits and includes graphers from the inner board", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.RuneArray);
    const inner = world.runeArrayWorldAt(0, 0);
    const recorder = new SignalTraceRecorder();
    recorder.sync(world, 0);
    const version = recorder.version;
    inner.place(0, 4, TileKind.Monitor);
    inner.setCharge(0, 4, -1);
    inner.place(1, 4, TileKind.Grapher, Direction.Right);
    inner.place(2, 4, TileKind.Rom);
    inner.configureTernaryGrid(2, 4, 2, 1, [1, -1]);
    recorder.sync(world, 0);
    expect(recorder.version).toBeGreaterThan(version);
    expect(recorder.lines(world)).toMatchObject([
      { kind: "monitor", charges: [-1] },
      { kind: "grapher", values: [1, -1], cursor: 0 },
    ]);
    inner.configureSignalLabel(0, 4, "RENAMED");
    recorder.sync(world, 0);
    expect(recorder.lines(world)[0]?.label).toContain("RENAMED");
  });

  it("shares a welded circuit network like a conduit", () => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.Monitor);
    world.place(2, 0, TileKind.Conduit);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 2, 0, true);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.chargeAt(1, 0)).toBe(1);
    expect(world.chargeAt(2, 0)).toBe(1);
  });

  it("records one charge per committed tick keyed by the monitor identity", () => {
    const world = createSparkMonitorWorld();
    const simulation = new Simulation(world);
    const recorder = new SignalTraceRecorder();

    recorder.sync(world, 0);
    simulation.step();
    recorder.sync(world, simulation.tick);
    simulation.step();
    recorder.sync(world, simulation.tick);

    const lines = recorder.lines(world);
    expect(lines).toEqual([
      {
        kind: "monitor",
        id: world.idAt(1, 0),
        world,
        label: "",
        firstTick: 0,
        charges: [0, 1, 0],
      },
    ]);
    const line = lines[0];
    expect(line).toBeDefined();
    if (line === undefined) {
      return;
    }
    expect(signalLineRowCount(line)).toBe(3);
    expect(signalLineChargeAtRow(line, 1)).toBe(1);
    expect(signalLineChargeAtRow(line, 3)).toBeNull();
  });

  it("is idempotent within a tick and rejects skipped ticks", () => {
    const world = createSparkMonitorWorld();
    const simulation = new Simulation(world);
    const recorder = new SignalTraceRecorder();

    recorder.sync(world, 0);
    const version = recorder.version;
    recorder.sync(world, 0);
    expect(recorder.version).toBe(version);

    simulation.step();
    simulation.step();
    expect(() => recorder.sync(world, simulation.tick)).toThrowError(
      "Signal traces observed tick 2 after tick 0",
    );
  });

  it("restarts histories when the world is replaced, reset, or edited at tick zero", () => {
    const world = createSparkMonitorWorld();
    const initial = world.clone();
    const simulation = new Simulation(world);
    const recorder = new SignalTraceRecorder();

    recorder.sync(world, 0);
    simulation.step();
    recorder.sync(world, 1);
    simulation.resetTo(initial);
    recorder.sync(world, 0);
    expect(recorder.lines(world)[0]).toMatchObject({ charges: [0] });

    world.place(2, 0, TileKind.Monitor);
    world.setWeld(1, 0, 2, 0, true);
    recorder.sync(world, 0);
    expect(recorder.lines(world)).toMatchObject([{ charges: [0] }, { charges: [0] }]);

    const other = createSparkMonitorWorld();
    recorder.sync(other, 5);
    expect(recorder.lines(other)).toEqual([
      { kind: "monitor", id: other.idAt(1, 0), world: other, label: "", firstTick: 5, charges: [0] },
    ]);
    expect(() => recorder.lines(world)).toThrowError(
      "Signal traces must be synchronized before reading lines",
    );
  });

  it("starts a late monitor's history at the tick it first appears", () => {
    const world = createSparkMonitorWorld();
    const simulation = new Simulation(world);
    const recorder = new SignalTraceRecorder();

    recorder.sync(world, 0);
    simulation.step();
    recorder.sync(world, 1);
    world.place(2, 0, TileKind.Monitor);
    simulation.step();
    recorder.sync(world, 2);

    expect(recorder.lines(world).map((line) => [line.kind, signalLineRowCount(line)])).toEqual([
      ["monitor", 3],
      ["monitor", 3],
    ]);
    expect(recorder.lines(world)[1]).toMatchObject({ firstTick: 2, charges: [0] });
  });

  it("names lines from their configured signal labels", () => {
    const world = createSparkMonitorWorld();
    expect(world.configureSignalLabel(1, 0, "OUT")).toBe(true);
    expect(world.configureSignalLabel(1, 0, "OUT")).toBe(false);
    expect(() => world.configureSignalLabel(1, 0, "far too long label")).toThrowError(
      "Signal name must be a string of at most 12 characters",
    );
    expect(() => world.configureSignalLabel(1, 0, "bad\nname")).toThrowError(
      "Signal name must not contain control characters",
    );
    expect(() => world.configureSignalLabel(0, 0, "spark")).toThrowError(
      "Configurable component at index 0 has no state",
    );
    const recorder = new SignalTraceRecorder();
    recorder.sync(world, 0);
    expect(recorder.lines(world)[0]?.label).toBe("OUT");
  });
});

describe("ROM graphers", () => {
  it("reports the pointed ROM's values and cursor without a weld", () => {
    const world = new World(4, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.Rom, Direction.Right);
    world.place(2, 0, TileKind.Grapher, Direction.Left);
    world.place(3, 0, TileKind.Grapher, Direction.Left);
    world.setWeld(0, 0, 1, 0, true);
    world.restoreComponentState(1, 0, {
      type: "rom",
      width: 2,
      height: 2,
      cursor: 0,
      values: [1, -1, 0, 1],
    });
    world.configureSignalLabel(2, 0, "expected");
    const simulation = new Simulation(world);
    const recorder = new SignalTraceRecorder();

    recorder.sync(world, 0);
    expect(recorder.lines(world)).toEqual([
      {
        kind: "grapher",
        id: world.idAt(2, 0),
        world,
        label: "expected",
        values: [1, -1, 0, 1],
        firstRow: 0,
        cursor: 0,
      },
      { kind: "grapher", id: world.idAt(3, 0), world, label: "", values: [], firstRow: 0, cursor: -1 },
    ]);

    simulation.step();
    recorder.sync(world, 1);
    simulation.step();
    recorder.sync(world, 2);
    const line = recorder.lines(world)[0];
    expect(line).toMatchObject({ kind: "grapher", cursor: 1 });
    expect(line === undefined ? null : signalLineRowCount(line)).toBe(4);
    expect(line === undefined ? null : signalLineChargeAtRow(line, 1)).toBe(-1);
    expect(line === undefined ? null : signalLineChargeAtRow(line, 4)).toBeNull();
  });

  it("aligns a checker's expected sequence with the tick whose input started it", () => {
    const world = new World(2, 3);
    world.place(0, 0, TileKind.Conduit);
    world.place(0, 1, TileKind.Checker, Direction.Down);
    world.place(1, 1, TileKind.Grapher, Direction.Left);
    world.place(0, 2, TileKind.Conduit);
    world.setWeld(0, 0, 0, 1, true);
    world.setWeld(0, 1, 0, 2, true);
    world.setWeld(0, 1, 1, 1, true);
    world.configureTernaryGrid(0, 1, 3, 1, [1, -1, 1]);
    const simulation = new Simulation(world);
    const recorder = new SignalTraceRecorder();

    recorder.sync(world, 0);
    expect(recorder.lines(world)[0]).toMatchObject({ firstRow: 0, cursor: 0 });
    simulation.step();
    recorder.sync(world, 1);
    simulation.step();
    recorder.sync(world, 2);
    const waiting = recorder.lines(world)[0];
    expect(waiting).toMatchObject({ kind: "grapher", firstRow: 2, cursor: 0 });
    expect(waiting === undefined ? null : signalLineChargeAtRow(waiting, 2)).toBe(1);
    expect(waiting === undefined ? null : signalLineRowCount(waiting)).toBe(5);

    world.setCharge(0, 0, 1);
    simulation.step();
    recorder.sync(world, 3);
    const started = recorder.lines(world)[0];
    expect(started).toMatchObject({ firstRow: 2, cursor: 1 });
    expect(started?.kind === "grapher" ? grapherCursorRow(started) : null).toBe(3);

    world.setCharge(0, 0, -1);
    simulation.step();
    recorder.sync(world, 4);
    world.setCharge(0, 0, 1);
    simulation.step();
    recorder.sync(world, 5);
    const finished = recorder.lines(world)[0];
    expect(finished).toMatchObject({ firstRow: 2, cursor: 3 });
    expect(finished?.kind === "grapher" ? grapherCursorRow(finished) : null).toBeNull();

    simulation.resetTo(new World(2, 3));
    recorder.sync(world, 0);
    expect(recorder.lines(world)).toEqual([]);
  });
});

describe("signal component board format", () => {
  it("round-trips monitor and grapher labels and rejects invalid ones", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Monitor);
    world.place(1, 0, TileKind.Grapher, Direction.Left);
    world.configureSignalLabel(0, 0, "IN");
    world.configureSignalLabel(1, 0, "Expected");

    const serialized = serializeBoard(world, 0);
    const parsed = JSON.parse(serialized) as { components: unknown[] };
    expect(parsed.components).toEqual([
      { x: 0, y: 0, type: "monitor", label: "IN" },
      { x: 1, y: 0, type: "grapher", label: "Expected" },
    ]);

    const imported = deserializeBoard(serialized);
    expect(imported.world.componentStateSnapshotAt(0, 0)).toEqual({ type: "monitor", label: "IN" });
    expect(imported.world.componentStateSnapshotAt(1, 0)).toEqual({
      type: "grapher",
      label: "Expected",
    });
    expect(imported.world.orientationAt(1, 0)).toBe(Direction.Left);

    parsed.components = [
      { x: 0, y: 0, type: "grapher", label: "IN" },
      { x: 1, y: 0, type: "grapher", label: "Expected" },
    ];
    expect(() => deserializeBoard(JSON.stringify(parsed))).toThrowError(
      "Component 0 does not match the tile at (0, 0)",
    );
    parsed.components = [
      { x: 0, y: 0, type: "monitor", label: "far too long label" },
      { x: 1, y: 0, type: "grapher", label: "Expected" },
    ];
    expect(() => deserializeBoard(JSON.stringify(parsed))).toThrowError(
      "Component 0 label is invalid",
    );
  });

  it("copies signal labels with cloned worlds", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Monitor);
    world.configureSignalLabel(0, 0, "OUT");
    const clone = world.clone();
    expect(clone.componentStateSnapshotAt(0, 0)).toEqual({ type: "monitor", label: "OUT" });
    clone.configureSignalLabel(0, 0, "OTHER");
    expect(world.componentStateSnapshotAt(0, 0)).toEqual({ type: "monitor", label: "OUT" });
  });
});
