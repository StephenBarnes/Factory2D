import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("directional grinders", () => {
  it.each([TileKind.Stone, TileKind.Glass])(
    "grinds %s in four active ticks without sharing furnace recipes or baking the resulting sand",
    (input) => {
      const world = new World(4, 1);
      world.place(0, 0, TileKind.Grinder, Direction.Right);
      const targetId = world.place(1, 0, input);
      world.place(2, 0, TileKind.Furnace, Direction.Right);
      world.place(3, 0, input);
      const simulation = new Simulation(world);

      for (let tick = 0; tick < 3; tick += 1) {
        simulation.step();
        expect(world.kindAt(1, 0)).toBe(input);
      }
      simulation.step();
      expect(world.kindAt(1, 0)).toBe(TileKind.Sand);
      expect(world.idAt(1, 0)).toBe(targetId);
      expect(world.kindAt(3, 0)).toBe(input);

      for (let tick = 0; tick < 4; tick += 1) simulation.step();
      expect(world.kindAt(1, 0)).toBe(TileKind.Sand);
      expect(world.kindAt(3, 0)).toBe(input);
      expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);
      expect(world.furnaceProgressAt(2, 0)).toBe(0);
    },
  );

  it("removes every existing target weld and leaves the resulting sand unweldable", () => {
    const world = new World(3, 2);
    world.place(1, 0, TileKind.Grinder, Direction.Down);
    world.place(1, 1, TileKind.Glass);
    world.place(0, 1, TileKind.Stone);
    world.place(2, 1, TileKind.Glass);
    const neighbors = [[1, 0], [0, 1], [2, 1]] as const;
    for (const [x, y] of neighbors) {
      expect(world.setWeld(1, 1, x, y, true)).toBe(true);
    }
    const simulation = new Simulation(world);

    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    for (const [x, y] of neighbors) {
      expect(world.isWelded(1, 1, x, y)).toBe(true);
    }
    simulation.step();

    expect(world.kindAt(1, 1)).toBe(TileKind.Sand);
    for (const [x, y] of neighbors) {
      expect(world.isWelded(1, 1, x, y)).toBe(false);
      expect(world.setWeld(1, 1, x, y, true)).toBe(false);
    }
  });

  it("pauses on negative charge and continues saved partial progress on positive charge", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Grinder, Direction.Right);
    world.place(1, 0, TileKind.Stone);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(1);
    expect(world.chargeAtPort(0, 0, Direction.Up)).toBe(0);

    world.setCharge(0, 0, -1);
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
    expect(world.furnaceProgressAt(0, 0)).toBe(2);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);

    const restored = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    const resumed = new Simulation(restored);
    restored.setCharge(0, 0, 1);
    resumed.step();
    expect(restored.kindAt(1, 0)).toBe(TileKind.Stone);
    expect(restored.chargeAtPort(0, 0, Direction.Left)).toBe(1);
    resumed.step();
    expect(restored.kindAt(1, 0)).toBe(TileKind.Sand);
  });

  it("restarts the full grinding duration for a replacement of the same material", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Grinder, Direction.Right);
    world.place(1, 0, TileKind.Stone);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();

    world.place(1, 0, TileKind.Empty);
    const replacementId = world.place(1, 0, TileKind.Stone);
    for (let tick = 0; tick < 3; tick += 1) {
      simulation.step();
      expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
    }
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Sand);
    expect(world.idAt(1, 0)).toBe(replacementId);
  });

  it("carries progress with a falling welded target and independently continues a clone", () => {
    const world = new World(2, 4);
    world.place(0, 0, TileKind.Grinder, Direction.Right);
    const targetId = world.place(1, 0, TileKind.Glass);
    world.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    expect(world.kindAt(0, 3)).toBe(TileKind.Grinder);
    expect(world.idAt(1, 3)).toBe(targetId);
    expect(world.kindAt(1, 3)).toBe(TileKind.Glass);

    const clone = world.clone();
    new Simulation(clone).step();
    expect(clone.kindAt(1, 3)).toBe(TileKind.Sand);
    expect(clone.idAt(1, 3)).toBe(targetId);
    expect(clone.isWelded(0, 3, 1, 3)).toBe(false);
    expect(world.kindAt(1, 3)).toBe(TileKind.Glass);
    expect(world.isWelded(0, 3, 1, 3)).toBe(true);
  });
});
