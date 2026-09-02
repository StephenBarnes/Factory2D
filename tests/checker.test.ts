import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import type { Charge } from "../src/simulation/circuit";
import { componentConfigurationForKind } from "../src/simulation/configurable-components";
import { Simulation } from "../src/simulation/simulation";
import {
  Direction,
  PaletteCategory,
  TILE_DEFINITIONS,
  TileKind,
  WeldSide,
} from "../src/simulation/tile";
import { World } from "../src/simulation/world";

/** Conduit at (0, 0) feeds an upward-facing checker at (0, 1) whose front output is (0, 2). */
function createCheckerWorld(values: readonly Charge[]): { world: World; simulation: Simulation } {
  const world = new World(1, 3);
  world.place(0, 0, TileKind.Conduit);
  world.place(0, 1, TileKind.Checker, Direction.Down);
  world.place(0, 2, TileKind.Conduit);
  world.setWeld(0, 0, 0, 1, true);
  world.setWeld(0, 1, 0, 2, true);
  world.configureTernaryGrid(0, 1, values.length, 1, values);
  return { world, simulation: new Simulation(world) };
}

/** Drives the rear conduit with one charge per tick and returns the front output after each tick. */
function drive(world: World, simulation: Simulation, inputs: readonly Charge[]): Charge[] {
  const outputs: Charge[] = [];
  for (const input of inputs) {
    world.setCharge(0, 0, input);
    simulation.step();
    outputs.push(world.chargeAt(0, 2));
  }
  return outputs;
}

describe("sequence checkers", () => {
  it("is a directional puzzle tool with an isolated rear input and front output", () => {
    const definition = TILE_DEFINITIONS[TileKind.Checker];
    expect(definition.palette?.category).toBe(PaletteCategory.PuzzleTools);
    expect(definition.usesOrientation).toBe(true);
    expect(definition.circuitInputPorts).toBe(WeldSide.Down);
    expect(definition.circuitOutputPorts).toBe(WeldSide.Up);
    expect(componentConfigurationForKind(TileKind.Checker)).toEqual({
      type: "grid",
      configureOnPlacement: false,
    });
  });

  it("waits through leading zeros, then emits +1 once every value has matched", () => {
    const { world, simulation } = createCheckerWorld([1, 0, -1]);

    expect(drive(world, simulation, [0, 0, 0, 1, 0, -1, 0, 1])).toEqual([
      0, 0, 0, 0, 0, 1, 1, 1,
    ]);
    expect(world.componentStateSnapshotAt(0, 1)).toEqual({
      type: "checker",
      width: 3,
      height: 1,
      cursor: 3,
      failed: false,
      values: [1, 0, -1],
    });
  });

  it("accepts the same sequence after any latency", () => {
    for (const latency of [0, 1, 4, 10]) {
      const { world, simulation } = createCheckerWorld([1, 1, 0, -1]);
      const inputs: Charge[] = [...new Array<Charge>(latency).fill(0), 1, 1, 0, -1];
      const outputs = drive(world, simulation, inputs);
      expect(outputs.at(-1)).toBe(1);
      expect(outputs.slice(0, -1).every((charge) => charge === 0)).toBe(true);
    }
  });

  it("latches -1 at the first mismatch and keeps the cursor on the mismatched value", () => {
    const { world, simulation } = createCheckerWorld([1, 0, 1, 1]);

    expect(drive(world, simulation, [1, 0, -1, 1, 1, 1])).toEqual([0, 0, -1, -1, -1, -1]);
    expect(world.componentStateSnapshotAt(0, 1)).toMatchObject({ cursor: 2, failed: true });
  });

  it("treats a wrong first nonzero input as the start of the sequence", () => {
    const { world, simulation } = createCheckerWorld([1, 1]);

    expect(drive(world, simulation, [0, -1, 1, 1])).toEqual([0, -1, -1, -1]);
  });

  it("reads a two-dimensional grid row by row and reports progress in the grid", () => {
    const world = new World(1, 3);
    world.place(0, 0, TileKind.Conduit);
    world.place(0, 1, TileKind.Checker, Direction.Down);
    world.place(0, 2, TileKind.Conduit);
    world.setWeld(0, 0, 0, 1, true);
    world.setWeld(0, 1, 0, 2, true);
    world.configureTernaryGrid(0, 1, 2, 2, [1, -1, 0, 1]);
    const simulation = new Simulation(world);

    expect(drive(world, simulation, [1, -1, 0, 1])).toEqual([0, 0, 0, 1]);
  });

  it("rewinds progress when reconfigured and rejects other grid changes", () => {
    const { world, simulation } = createCheckerWorld([1, 1]);
    drive(world, simulation, [1, -1]);
    expect(world.componentStateSnapshotAt(0, 1)).toMatchObject({ cursor: 1, failed: true });

    expect(world.configureTernaryGrid(0, 1, 2, 1, [1, 1])).toBe(false);
    expect(world.configureTernaryGrid(0, 1, 2, 1, [1, 0])).toBe(true);
    expect(world.componentStateSnapshotAt(0, 1)).toEqual({
      type: "checker",
      width: 2,
      height: 1,
      cursor: 0,
      failed: false,
      values: [1, 0],
    });
    expect(world.chargeAt(0, 1)).toBe(0);
  });

  it("round-trips progress through board JSON and validates the cursor against the verdict", () => {
    const { world, simulation } = createCheckerWorld([1, 0]);
    drive(world, simulation, [1, 0]);

    const serialized = serializeBoard(world, 2);
    const parsed = JSON.parse(serialized) as { components: Record<string, unknown>[] };
    expect(parsed.components).toEqual([
      { x: 0, y: 1, type: "checker", width: 2, height: 1, cursor: 2, failed: false, values: [1, 0] },
    ]);
    const imported = deserializeBoard(serialized);
    expect(imported.world.componentStateSnapshotAt(0, 1)).toEqual({
      type: "checker",
      width: 2,
      height: 1,
      cursor: 2,
      failed: false,
      values: [1, 0],
    });
    expect(imported.world.chargeAt(0, 2)).toBe(1);

    parsed.components = [
      { x: 0, y: 1, type: "checker", width: 2, height: 1, cursor: 2, failed: true, values: [1, 0] },
    ];
    expect(() => deserializeBoard(JSON.stringify(parsed))).toThrowError(
      "Component 0 cursor must be an integer from 0 through 1",
    );
    parsed.components = [
      { x: 0, y: 1, type: "checker", width: 2, height: 1, cursor: 0, failed: "no", values: [1, 0] },
    ];
    expect(() => deserializeBoard(JSON.stringify(parsed))).toThrowError(
      "Component 0 failed must be a boolean",
    );
    parsed.components = [
      { x: 0, y: 1, type: "rom", width: 2, height: 1, cursor: 0, values: [1, 0] },
    ];
    expect(() => deserializeBoard(JSON.stringify(parsed))).toThrowError(
      "Component 0 does not match the tile at (0, 1)",
    );
  });

  it("copies checker progress with cloned worlds", () => {
    const { world, simulation } = createCheckerWorld([1, 1]);
    drive(world, simulation, [1]);
    const clone = world.clone();
    expect(clone.componentStateSnapshotAt(0, 1)).toMatchObject({ cursor: 1, failed: false });
    clone.configureTernaryGrid(0, 1, 1, 1, [-1]);
    expect(world.componentStateSnapshotAt(0, 1)).toMatchObject({ cursor: 1, values: [1, 1] });
  });
});
