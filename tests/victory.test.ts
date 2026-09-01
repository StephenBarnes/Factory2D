import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { PuzzleResult } from "../src/simulation/puzzle-result";
import { Simulation } from "../src/simulation/simulation";
import { TILE_DEFINITIONS, TileKind, WeldSide } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("victory blocks", () => {
  it.each([
    { charge: 1 as const, result: PuzzleResult.Won },
    { charge: -1 as const, result: PuzzleResult.Lost },
  ])("latches result $result from a welded $charge input", ({ charge, result }) => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Conduit);
    world.place(1, 0, TileKind.Victory);
    world.setWeld(0, 0, 1, 0, true);
    world.setCharge(0, 0, charge);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.puzzleResult).toBe(result);
    world.setCharge(0, 0, charge === 1 ? -1 : 1);
    simulation.step();
    expect(world.puzzleResult).toBe(result);
  });

  it("ignores unwelded charges", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Conduit);
    world.place(1, 0, TileKind.Victory);
    world.setCharge(0, 0, 1);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.puzzleResult).toBe(PuzzleResult.InProgress);
  });

  it("jams opposing input intents without depending on input order", () => {
    const world = new World(3, 2);
    world.place(0, 1, TileKind.Conduit);
    world.place(1, 0, TileKind.Conduit);
    world.place(1, 1, TileKind.Victory);
    world.place(2, 1, TileKind.Conduit);
    world.setWeld(0, 1, 1, 1, true);
    world.setWeld(1, 0, 1, 1, true);
    world.setWeld(1, 1, 2, 1, true);
    world.setCharge(0, 1, 1);
    world.setCharge(1, 0, -1);
    world.setCharge(2, 1, 1);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.puzzleResult).toBe(PuzzleResult.InProgress);
  });

  it("restores an in-progress snapshot on simulation reset", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Conduit);
    world.place(1, 0, TileKind.Victory);
    world.setWeld(0, 0, 1, 0, true);
    const baseline = world.clone();
    world.setCharge(0, 0, 1);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.puzzleResult).toBe(PuzzleResult.Won);

    simulation.resetTo(baseline);

    expect(world.puzzleResult).toBe(PuzzleResult.InProgress);
    expect(simulation.tick).toBe(0);
  });

  it("round-trips its tile and terminal result through board JSON", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Victory);
    world.markPuzzleResult(PuzzleResult.Lost);

    const serialized = serializeBoard(world, 9);
    const imported = deserializeBoard(serialized);

    expect(JSON.parse(serialized)).toMatchObject({
      version: 9,
      tick: 9,
      result: "lost",
      grid: ["V"],
    });
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.Victory);
    expect(imported.world.puzzleResult).toBe(PuzzleResult.Lost);
  });

  it("defines four isolated input ports and no output network", () => {
    const definition = TILE_DEFINITIONS[TileKind.Victory];

    expect(definition.usesOrientation).toBe(false);
    expect(definition.circuitPorts).toBe(WeldSide.All);
    expect(definition.circuitInputPorts).toBe(WeldSide.All);
    expect(definition.circuitOutputPorts).toBe(WeldSide.None);
  });
});
