import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("directional furnaces", () => {
  it.each([
    { input: TileKind.Sand, output: TileKind.Glass, bakeTime: 4 },
    { input: TileKind.IronOre, output: TileKind.Iron, bakeTime: 6 },
  ])(
    "transforms $input into $output after $bakeTime active ticks",
    ({ input, output, bakeTime }) => {
      const world = new World(2, 1);
      world.place(0, 0, TileKind.Furnace, Direction.Right);
      const targetId = world.place(1, 0, input);
      const simulation = new Simulation(world);

      for (let progress = 1; progress < bakeTime; progress += 1) {
        simulation.step();
        expect(world.kindAt(1, 0)).toBe(input);
        expect(world.furnaceProgressAt(0, 0)).toBe(progress);
      }

      simulation.step();

      expect(world.kindAt(1, 0)).toBe(output);
      expect(world.idAt(1, 0)).toBe(targetId);
      expect(world.furnaceProgressAt(0, 0)).toBe(0);
    },
  );

  it("pauses copper smelting and its output without wood, including across save/load", () => {
    let world = new World(3, 1);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    const oreId = world.place(1, 0, TileKind.CopperOre);
    let simulation = new Simulation(world);
    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(0);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);

    const woodId = world.place(2, 0, TileKind.Wood);
    simulation.step();
    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(2);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(1);
    expect(world.idAt(1, 0)).toBe(oreId);
    expect(world.idAt(2, 0)).toBe(woodId);

    world.place(2, 0, TileKind.Empty);
    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(2);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);
    world = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    simulation = new Simulation(world);
    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(2);

    world.place(2, 0, TileKind.Wood);
    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.CopperOre);
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Copper);
    expect(world.kindAt(2, 0)).toBe(TileKind.Wood);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(1);
    simulation.step();
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);
  });

  it("does not treat diagonal or row-wrapped wood as adjacent to copper ore", () => {
    const world = new World(3, 2);
    world.place(1, 1, TileKind.Furnace, Direction.Left);
    world.place(0, 1, TileKind.CopperOre);
    world.place(1, 0, TileKind.Wood);
    world.place(2, 0, TileKind.Wood);
    world.place(2, 1, TileKind.Platform);
    world.setWeld(1, 0, 2, 0, true);
    world.setWeld(2, 0, 2, 1, true);
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 6; tick += 1) simulation.step();
    expect(world.kindAt(0, 1)).toBe(TileKind.CopperOre);
    expect(world.furnaceProgressAt(1, 1)).toBe(0);

    world.place(0, 0, TileKind.Wood);
    for (let tick = 0; tick < 6; tick += 1) simulation.step();
    expect(world.kindAt(0, 1)).toBe(TileKind.Copper);
  });

  it("welds cooked glass only to existing adjacent glass on completion", () => {
    const world = new World(3, 3);
    world.place(1, 0, TileKind.Furnace, Direction.Down);
    world.place(1, 1, TileKind.Sand);
    world.place(0, 1, TileKind.Glass);
    world.place(2, 1, TileKind.Iron);
    world.place(1, 2, TileKind.Glass);
    world.place(0, 2, TileKind.Platform);
    world.place(2, 2, TileKind.Platform);
    const simulation = new Simulation(world);

    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    expect(world.isWelded(1, 1, 0, 1)).toBe(false);
    expect(world.isWelded(1, 1, 1, 2)).toBe(false);
    world.setCharge(1, 0, -1);
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Sand);
    expect(world.isWelded(1, 1, 0, 1)).toBe(false);
    world.setCharge(1, 0, 0);
    simulation.step();

    expect(world.kindAt(1, 1)).toBe(TileKind.Glass);
    expect(world.isWelded(1, 1, 0, 1)).toBe(true);
    expect(world.isWelded(1, 1, 1, 2)).toBe(true);
    expect(world.isWelded(1, 1, 2, 1)).toBe(false);
    expect(world.isWelded(1, 1, 1, 0)).toBe(false);
    const restored = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    expect(restored.isWelded(1, 1, 0, 1)).toBe(true);
    expect(restored.isWelded(1, 1, 1, 2)).toBe(true);
  });

  it("does not weld simultaneously cooked neighbors or add welds on later ticks", () => {
    const world = new World(2, 2);
    for (let x = 0; x < 2; x += 1) {
      world.place(x, 0, TileKind.Furnace, Direction.Down);
      world.place(x, 1, TileKind.Sand);
    }
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 5; tick += 1) simulation.step();

    expect(world.kindAt(0, 1)).toBe(TileKind.Glass);
    expect(world.kindAt(1, 1)).toBe(TileKind.Glass);
    expect(world.isWelded(0, 1, 1, 1)).toBe(false);
  });

  it("leaves iron smelting unwelded next to iron and glass", () => {
    const world = new World(3, 2);
    world.place(0, 1, TileKind.Glass);
    world.place(1, 0, TileKind.Furnace, Direction.Down);
    world.place(1, 1, TileKind.IronOre);
    world.place(2, 1, TileKind.Iron);
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 6; tick += 1) simulation.step();

    expect(world.kindAt(1, 1)).toBe(TileKind.Iron);
    expect(world.isWelded(1, 1, 0, 1)).toBe(false);
    expect(world.isWelded(1, 1, 2, 1)).toBe(false);
  });

  it("restarts when the target identity changes", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    const firstTargetId = world.place(1, 0, TileKind.Sand);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(2);

    world.place(1, 0, TileKind.Empty);
    const replacementId = world.place(1, 0, TileKind.Sand);
    expect(replacementId).not.toBe(firstTargetId);
    simulation.step();

    expect(world.furnaceProgressAt(0, 0)).toBe(1);
  });

  it("cuts baking short when the target moves away", () => {
    const world = new World(3, 3);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    world.place(0, 1, TileKind.Platform);
    world.setWeld(0, 0, 0, 1, true);
    const sandId = world.place(1, 0, TileKind.Sand);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(1, 1)).toBe(sandId);
    expect(world.furnaceProgressAt(0, 0)).toBe(1);

    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(0);
  });

  it("pauses only on negative side charge and isolates its rear baking output", () => {
    const world = new World(5, 3);
    world.place(2, 0, TileKind.Sand);
    world.place(2, 1, TileKind.Furnace, Direction.Up);
    world.place(1, 1, TileKind.Conduit);
    world.place(3, 1, TileKind.Conduit);
    world.place(2, 2, TileKind.Conduit);
    world.setWeld(2, 1, 1, 1, true);
    world.setWeld(2, 1, 3, 1, true);
    world.setWeld(2, 1, 2, 2, true);
    const simulation = new Simulation(world);

    world.setCharge(2, 2, -1);
    simulation.step();
    expect(world.furnaceProgressAt(2, 1)).toBe(1);
    expect(world.chargeAt(2, 2)).toBe(1);
    expect(world.chargeAt(1, 1)).toBe(0);
    expect(world.chargeAt(3, 1)).toBe(0);

    world.setCharge(2, 1, -1);
    simulation.step();
    expect(world.furnaceProgressAt(2, 1)).toBe(1);
    expect(world.chargeAt(2, 2)).toBe(0);

    world.setCharge(2, 1, 1);
    simulation.step();
    expect(world.furnaceProgressAt(2, 1)).toBe(2);
    expect(world.chargeAtPort(2, 1, Direction.Down)).toBe(1);
    expect(world.chargeAtPort(2, 1, Direction.Left)).toBe(0);

    const imported = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    expect(imported.furnaceProgressAt(2, 1)).toBe(2);
    expect(imported.chargeAtPort(2, 1, Direction.Down)).toBe(1);
    expect(imported.chargeAtPort(2, 1, Direction.Left)).toBe(0);

    simulation.step();
    simulation.step();
    expect(world.kindAt(2, 0)).toBe(TileKind.Glass);
    expect(world.chargeAt(2, 2)).toBe(1);
    simulation.step();
    expect(world.chargeAt(2, 2)).toBe(0);
  });

  it("disables a welded row together and resumes after disconnecting the negative source", () => {
    const world = new World(4, 3);
    world.place(0, 1, TileKind.FixedCharge);
    world.place(1, 1, TileKind.Inverter, Direction.Right);
    world.place(1, 2, TileKind.Platform);
    world.setWeld(0, 1, 1, 1, true);
    for (const x of [2, 3]) {
      world.place(x, 0, TileKind.Sand);
      world.place(x, 1, TileKind.Furnace, Direction.Up);
      world.place(x, 2, TileKind.Conduit);
      world.setWeld(x - 1, 1, x, 1, true);
      world.setWeld(x, 1, x, 2, true);
    }
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 6; tick += 1) simulation.step();
    for (const x of [2, 3]) {
      expect(world.furnaceProgressAt(x, 1)).toBe(2);
      expect(world.chargeAt(x, 1)).toBe(-1);
      expect(world.chargeAt(x, 2)).toBe(0);
      expect(world.kindAt(x, 0)).toBe(TileKind.Sand);
    }

    world.setWeld(1, 1, 2, 1, false);
    simulation.step();
    simulation.step();
    simulation.step();
    for (const x of [2, 3]) {
      expect(world.kindAt(x, 0)).toBe(TileKind.Glass);
      expect(world.chargeAt(x, 2)).toBe(1);
    }
  });

  it("restores bake progress with a simulation snapshot", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    world.place(1, 0, TileKind.Sand);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    const snapshot = world.clone();

    simulation.step();
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Glass);

    simulation.resetTo(snapshot);
    expect(world.kindAt(1, 0)).toBe(TileKind.Sand);
    expect(world.furnaceProgressAt(0, 0)).toBe(2);
  });
});
