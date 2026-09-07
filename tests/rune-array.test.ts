import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import {
  componentConfigurationForKind,
  transformComponentSnapshot,
} from "../src/simulation/configurable-components";
import { PuzzleResult } from "../src/simulation/puzzle-result";
import {
  MAX_RUNE_ARRAY_DEPTH,
  runeArrayPortCellIndex,
  transformRuneArrayPorts,
} from "../src/simulation/rune-array";
import { Simulation } from "../src/simulation/simulation";
import {
  Direction,
  TILE_DEFINITIONS,
  TileKind,
  WeldSide,
} from "../src/simulation/tile";
import { World } from "../src/simulation/world";

/**
 * Root row: fixed charge (0, 0) welded to a rune array (1, 0) welded to a conduit (2, 0),
 * with the array resized to 3x1 so its left port cell is (0, 0) and right port cell (2, 0)
 * and nothing inside can fall.
 */
function createPassthroughWorld(
  innerHeight = 1,
): { world: World; inner: World; simulation: Simulation } {
  const world = new World(3, 1);
  world.place(0, 0, TileKind.FixedCharge);
  world.place(1, 0, TileKind.RuneArray);
  world.place(2, 0, TileKind.Conduit);
  world.setWeld(0, 0, 1, 0, true);
  world.setWeld(1, 0, 2, 0, true);
  world.configureRuneArray(1, 0, 3, innerHeight, "");
  return { world, inner: world.runeArrayWorldAt(1, 0), simulation: new Simulation(world) };
}

function fillConduitRow(inner: World, y: number): void {
  for (let x = 0; x < inner.width; x += 1) {
    inner.place(x, y, TileKind.Conduit);
    if (x > 0) {
      inner.setWeld(x - 1, y, x, y, true);
    }
  }
}

describe("rune arrays", () => {
  it("is a non-directional circuit component with four independent shared side ports", () => {
    const definition = TILE_DEFINITIONS[TileKind.RuneArray];
    expect(definition.usesOrientation).toBe(false);
    expect(definition.circuitPorts).toBe(WeldSide.All);
    expect(definition.circuitInputPorts).toBe(WeldSide.None);
    expect(definition.circuitOutputPorts).toBe(WeldSide.None);
    expect(definition.affectedByGravity).toBe(true);
    expect(componentConfigurationForKind(TileKind.RuneArray)).toEqual({
      type: "array",
      configureOnPlacement: false,
    });

    const world = new World(1, 1);
    world.place(0, 0, TileKind.RuneArray);
    const state = world.componentStateSnapshotAt(0, 0);
    expect(state?.type).toBe("array");
    if (state?.type !== "array") {
      throw new Error("Missing array state");
    }
    expect(state.description).toBe("");
    expect(state.ports).toEqual([0, 0, 0, 0]);
    expect(state.world.width).toBe(5);
    expect(state.world.height).toBe(5);
    expect(() => world.chargeAt(0, 0)).toThrow("read from a circuit port");
    expect(() => world.setCharge(0, 0, 1)).toThrow("side port");
  });

  it("maps every outer side to the inner edge-center cell", () => {
    expect(runeArrayPortCellIndex(5, 3, Direction.Up)).toBe(2);
    expect(runeArrayPortCellIndex(5, 3, Direction.Right)).toBe(9);
    expect(runeArrayPortCellIndex(5, 3, Direction.Down)).toBe(12);
    expect(runeArrayPortCellIndex(5, 3, Direction.Left)).toBe(5);
    expect(runeArrayPortCellIndex(1, 1, Direction.Down)).toBe(0);
  });

  it("passes a signal through an inner conduit line in the same tick", () => {
    const { world, inner, simulation } = createPassthroughWorld();
    fillConduitRow(inner, 0);

    simulation.step();

    expect(world.chargeAt(2, 0)).toBe(1);
    expect(inner.chargeAt(1, 0)).toBe(1);
    expect(world.chargeAtPort(1, 0, Direction.Left)).toBe(1);
    expect(world.chargeAtPort(1, 0, Direction.Right)).toBe(1);
    // A one-row board's center cell is also its top and bottom edge center.
    expect(world.chargeAtPort(1, 0, Direction.Up)).toBe(1);
    expect(world.chargeAtPort(1, 0, Direction.Down)).toBe(1);

    const tall = createPassthroughWorld(3);
    tall.inner.place(0, 1, TileKind.Platform);
    tall.inner.place(1, 1, TileKind.Conduit);
    tall.inner.place(2, 1, TileKind.Platform);
    tall.inner.place(1, 2, TileKind.Platform);
    tall.inner.setWeld(0, 1, 1, 1, true);
    tall.inner.setWeld(1, 1, 2, 1, true);
    tall.inner.setWeld(1, 1, 1, 2, true);
    tall.simulation.step();
    expect(tall.world.chargeAtPort(1, 0, Direction.Left)).toBe(1);
    expect(tall.world.chargeAtPort(1, 0, Direction.Right)).toBe(0);
    expect(tall.world.chargeAtPort(1, 0, Direction.Up)).toBe(0);
    expect(tall.world.chargeAtPort(1, 0, Direction.Down)).toBe(0);
  });

  it("rebuilds cached circuit topology after replacing an inner world", () => {
    const { world, inner, simulation } = createPassthroughWorld();
    fillConduitRow(inner, 0);
    simulation.step();
    expect(world.chargeAt(2, 0)).toBe(1);

    world.configureRuneArray(1, 0, 5, 1, "");
    const resizedInner = world.runeArrayWorldAt(1, 0);
    fillConduitRow(resizedInner, 0);
    simulation.step();

    expect(world.chargeAt(2, 0)).toBe(1);
    expect(resizedInner.chargeAt(2, 0)).toBe(1);
  });

  it("keeps the outer sides separate while nothing inside connects them", () => {
    const { world, inner, simulation } = createPassthroughWorld();
    inner.place(0, 0, TileKind.Conduit);
    inner.place(2, 0, TileKind.Conduit);

    simulation.step();

    expect(world.chargeAt(2, 0)).toBe(0);
    expect(inner.chargeAt(0, 0)).toBe(1);
    expect(inner.chargeAt(2, 0)).toBe(0);
    expect(world.chargeAtPort(1, 0, Direction.Left)).toBe(1);
    expect(world.chargeAtPort(1, 0, Direction.Right)).toBe(0);
  });

  it("runs inner gates with the usual one-tick latency", () => {
    const { world, inner, simulation } = createPassthroughWorld();
    inner.place(0, 0, TileKind.Conduit);
    inner.place(1, 0, TileKind.Inverter, Direction.Right);
    inner.place(2, 0, TileKind.Conduit);
    inner.setWeld(0, 0, 1, 0, true);
    inner.setWeld(1, 0, 2, 0, true);

    simulation.step();
    expect(world.chargeAt(2, 0)).toBe(0);
    simulation.step();
    expect(world.chargeAt(2, 0)).toBe(-1);
    expect(world.chargeAtPort(1, 0, Direction.Right)).toBe(-1);
  });

  it("lets edge-center gates read from and drive the virtual side ports directly", () => {
    const { world, inner, simulation } = createPassthroughWorld();
    inner.place(0, 0, TileKind.Inverter, Direction.Right);
    inner.place(1, 0, TileKind.Conduit);
    inner.place(2, 0, TileKind.Conduit);
    inner.setWeld(0, 0, 1, 0, true);
    inner.setWeld(1, 0, 2, 0, true);

    simulation.step();
    simulation.step();

    expect(world.chargeAt(2, 0)).toBe(-1);

    const reversed = createPassthroughWorld();
    reversed.inner.place(0, 0, TileKind.Conduit);
    reversed.inner.place(1, 0, TileKind.Conduit);
    reversed.inner.place(2, 0, TileKind.Inverter, Direction.Right);
    reversed.inner.setWeld(0, 0, 1, 0, true);
    reversed.inner.setWeld(1, 0, 2, 0, true);

    reversed.simulation.step();
    reversed.simulation.step();

    expect(reversed.world.chargeAt(2, 0)).toBe(-1);
  });

  it("simulates gravity and other physics inside the array", () => {
    const { world, inner, simulation } = createPassthroughWorld(3);
    inner.place(1, 0, TileKind.Stone);

    simulation.step();
    expect(inner.kindAt(1, 1)).toBe(TileKind.Stone);
    simulation.step();
    expect(inner.kindAt(1, 2)).toBe(TileKind.Stone);
    simulation.step();
    expect(inner.kindAt(1, 2)).toBe(TileKind.Stone);
    expect(world.kindAt(1, 0)).toBe(TileKind.RuneArray);
  });

  it("passes signals through arrays nested inside arrays", () => {
    const { world, inner, simulation } = createPassthroughWorld();
    inner.place(0, 0, TileKind.Conduit);
    inner.place(1, 0, TileKind.RuneArray);
    inner.place(2, 0, TileKind.Conduit);
    inner.setWeld(0, 0, 1, 0, true);
    inner.setWeld(1, 0, 2, 0, true);
    inner.configureRuneArray(1, 0, 3, 1, "deepest");
    fillConduitRow(inner.runeArrayWorldAt(1, 0), 0);

    simulation.step();

    expect(world.chargeAt(2, 0)).toBe(1);
    expect(inner.runeArrayWorldAt(1, 0).chargeAt(1, 0)).toBe(1);
  });

  it("latches the root puzzle result from a victory block inside an array", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.RuneArray);
    world.setWeld(0, 0, 1, 0, true);
    world.configureRuneArray(1, 0, 3, 1, "");
    const inner = world.runeArrayWorldAt(1, 0);
    inner.place(0, 0, TileKind.Conduit);
    inner.place(1, 0, TileKind.Victory);
    inner.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.puzzleResult).toBe(PuzzleResult.InProgress);
    simulation.step();
    expect(world.puzzleResult).toBe(PuzzleResult.Won);
    expect(inner.puzzleResult).toBe(PuzzleResult.InProgress);
  });

  it("resizes around the center and rewinds ports", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.RuneArray);
    world.configureRuneArray(0, 0, 3, 3, "first");
    const inner = world.runeArrayWorldAt(0, 0);
    inner.place(1, 1, TileKind.Stone);
    inner.place(0, 1, TileKind.Conduit);
    inner.setWeld(0, 1, 1, 1, true);

    expect(world.configureRuneArray(0, 0, 3, 3, "first")).toBe(false);
    expect(world.configureRuneArray(0, 0, 5, 5, "second")).toBe(true);
    const grown = world.runeArrayWorldAt(0, 0);
    expect(grown).not.toBe(inner);
    expect(grown.kindAt(2, 2)).toBe(TileKind.Stone);
    expect(grown.kindAt(1, 2)).toBe(TileKind.Conduit);
    expect(grown.isWelded(1, 2, 2, 2)).toBe(true);
    const state = world.componentStateSnapshotAt(0, 0);
    expect(state?.type === "array" && state.description).toBe("second");

    expect(world.configureRuneArray(0, 0, 1, 1, "second")).toBe(true);
    const shrunk = world.runeArrayWorldAt(0, 0);
    expect(shrunk.kindAt(0, 0)).toBe(TileKind.Stone);
    expect(() => world.configureRuneArray(0, 0, 4, 3, "")).toThrow("odd integer");
    expect(() => world.configureRuneArray(0, 0, 3, 3, "x".repeat(201))).toThrow("at most 200");
  });

  it("rotates and flips the inner board with the tile and remaps its ports", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.RuneArray);
    world.configureRuneArray(0, 0, 3, 1, "");
    const inner = world.runeArrayWorldAt(0, 0);
    inner.place(0, 0, TileKind.Sensor, Direction.Right);
    inner.place(1, 0, TileKind.Stone);
    inner.setWeld(0, 0, 1, 0, true);
    const snapshot = world.componentStateSnapshotAt(0, 0);
    if (snapshot?.type !== "array") {
      throw new Error("Missing array snapshot");
    }
    const ports = Int8Array.from([1, 0, -1, 0]);
    world.applyCircuitCharges(new Int8Array(1), new Int8Array(1), new Int8Array(1), ports);

    const rotated = transformComponentSnapshot(
      { ...snapshot, ports: [1, 0, -1, 0] },
      1,
      false,
      false,
    );
    if (rotated.type !== "array") {
      throw new Error("Rotated snapshot lost its array state");
    }
    expect(rotated.world.width).toBe(1);
    expect(rotated.world.height).toBe(3);
    expect(rotated.world.kindAt(0, 0)).toBe(TileKind.Sensor);
    expect(rotated.world.orientationAt(0, 0)).toBe(Direction.Down);
    expect(rotated.world.kindAt(0, 1)).toBe(TileKind.Stone);
    expect(rotated.world.isWelded(0, 0, 0, 1)).toBe(true);
    expect(rotated.ports).toEqual([0, 1, 0, -1]);

    const flipped = transformComponentSnapshot(snapshot, 0, true, false);
    if (flipped.type !== "array") {
      throw new Error("Flipped snapshot lost its array state");
    }
    expect(flipped.world.kindAt(2, 0)).toBe(TileKind.Sensor);
    expect(flipped.world.orientationAt(2, 0)).toBe(Direction.Left);
    expect(flipped.world.kindAt(1, 0)).toBe(TileKind.Stone);
    expect(transformRuneArrayPorts([1, 0, -1, 0], 0, true, false)).toEqual([1, 0, -1, 0]);
    expect(transformRuneArrayPorts([1, 0, -1, 0], 0, false, true)).toEqual([-1, 0, 1, 0]);
    expect(transformComponentSnapshot(snapshot, 4, false, false)).toBe(snapshot);
  });

  it("mirrors the inner board when a duplicator copies the array", () => {
    const world = new World(2, 3);
    world.place(0, 1, TileKind.Duplicator, Direction.Up);
    world.place(1, 1, TileKind.FixedCharge);
    world.place(1, 2, TileKind.Platform);
    world.place(0, 2, TileKind.RuneArray);
    world.setWeld(0, 1, 1, 1, true);
    world.configureRuneArray(0, 2, 3, 3, "mirror me");
    const inner = world.runeArrayWorldAt(0, 2);
    inner.place(0, 0, TileKind.Platform);
    inner.place(1, 0, TileKind.Sensor, Direction.Down);
    inner.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();

    expect(world.kindAt(0, 0)).toBe(TileKind.RuneArray);
    const copy = world.runeArrayWorldAt(0, 0);
    expect(copy).not.toBe(inner);
    expect(copy.kindAt(0, 2)).toBe(TileKind.Platform);
    expect(copy.kindAt(1, 2)).toBe(TileKind.Sensor);
    expect(copy.orientationAt(1, 2)).toBe(Direction.Up);
    expect(copy.isWelded(0, 2, 1, 2)).toBe(true);
    expect(inner.kindAt(0, 0)).toBe(TileKind.Platform);
    const copyState = world.componentStateSnapshotAt(0, 0);
    expect(copyState?.type === "array" && copyState.description).toBe("mirror me");
  });

  it("reuses inner worlds across copies with matching identities and dimensions", () => {
    const { world, inner, simulation } = createPassthroughWorld();
    fillConduitRow(inner, 0);
    const baseline = world.clone();
    expect(baseline.runeArrayWorldAt(1, 0)).not.toBe(inner);

    simulation.step();
    expect(inner.chargeAt(1, 0)).toBe(1);
    simulation.resetTo(baseline);

    expect(world.runeArrayWorldAt(1, 0)).toBe(inner);
    expect(inner.chargeAt(1, 0)).toBe(0);
    expect(inner.kindAt(0, 0)).toBe(TileKind.Conduit);
  });

  it("round-trips nested boards, descriptions, and ports through board JSON", () => {
    const { world, inner, simulation } = createPassthroughWorld();
    inner.place(0, 0, TileKind.Conduit);
    inner.place(1, 0, TileKind.RuneArray);
    inner.place(2, 0, TileKind.Delay, Direction.Left);
    inner.setWeld(0, 0, 1, 0, true);
    inner.setWeld(1, 0, 2, 0, true);
    inner.configureRuneArray(1, 0, 1, 1, "inner\nline");
    inner.runeArrayWorldAt(1, 0).place(0, 0, TileKind.Conduit);
    world.configureRuneArray(1, 0, 3, 1, "outer");
    simulation.step();

    const serialized = serializeBoard(world, simulation.tick);
    const parsed = JSON.parse(serialized) as {
      components: {
        type: string;
        description: string;
        ports: number[];
        board: { width: number; components: { board: { grid: string[] } }[] };
      }[];
    };
    expect(parsed.components[0]?.type).toBe("array");
    expect(parsed.components[0]?.description).toBe("outer");
    expect(parsed.components[0]?.ports).toEqual([1, 0, 1, 1]);
    expect(parsed.components[0]?.board.width).toBe(3);
    expect(parsed.components[0]?.board.components[0]?.board.grid).toEqual(["C"]);

    const imported = deserializeBoard(serialized);
    expect(imported.tick).toBe(1);
    expect(serializeBoard(imported.world, imported.tick)).toBe(serialized);
    const importedInner = imported.world.runeArrayWorldAt(1, 0);
    expect(importedInner.kindAt(2, 0)).toBe(TileKind.Delay);
    expect(importedInner.orientationAt(2, 0)).toBe(Direction.Left);
    expect(importedInner.chargeAt(0, 0)).toBe(1);
    expect(importedInner.chargeAtPort(1, 0, Direction.Left)).toBe(1);
    expect(imported.world.chargeAtPort(1, 0, Direction.Left)).toBe(1);
    expect(imported.world.chargeAtPort(1, 0, Direction.Up)).toBe(1);
  });

  it("rejects even inner dimensions, bad ports, and excessive nesting in board JSON", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.RuneArray);
    const board = JSON.parse(serializeBoard(world, 0)) as {
      components: { ports: number[]; board: { width: number; grid: string[]; welds: string[] } }[];
    };
    const entry = board.components[0];
    if (entry === undefined) {
      throw new Error("Missing array component");
    }
    entry.board.width = 4;
    entry.board.grid = entry.board.grid.map((row) => row.slice(0, 4));
    entry.board.welds = entry.board.welds.map((row) => row.slice(0, 4));
    expect(() => deserializeBoard(JSON.stringify(board))).toThrow(
      "Component 0 board width must be an odd integer",
    );

    const badPorts = JSON.parse(serializeBoard(world, 0)) as typeof board;
    badPorts.components[0]!.ports = [1, 0, 0];
    expect(() => deserializeBoard(JSON.stringify(badPorts))).toThrow(
      "Component 0 ports must contain exactly 4 values",
    );

    let nested = new World(1, 1);
    for (let depth = 0; depth <= MAX_RUNE_ARRAY_DEPTH; depth += 1) {
      const outer = new World(1, 1);
      outer.place(0, 0, TileKind.RuneArray);
      outer.restoreComponentState(0, 0, {
        type: "array",
        description: "",
        ports: [0, 0, 0, 0],
        world: nested,
      });
      nested = outer;
    }
    expect(() => deserializeBoard(serializeBoard(nested, 0))).toThrow("nests rune arrays deeper");
  });
});
