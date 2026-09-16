import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("floatstone", () => {
  it("holds its welded body aloft after serialization, then releases it when unwelded", () => {
    const original = new World(3, 4);
    original.place(0, 0, TileKind.Floatstone);
    original.place(1, 0, TileKind.Stone);
    original.setWeld(0, 0, 1, 0, true);
    const world = deserializeBoard(serializeBoard(original, 0)).world;
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.kindAt(0, 0)).toBe(TileKind.Floatstone);
    expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
    world.setWeld(0, 0, 1, 0, false);
    simulation.step();
    expect(world.kindAt(0, 0)).toBe(TileKind.Floatstone);
    expect(world.kindAt(1, 1)).toBe(TileKind.Stone);
  });

  it("pushes a floating chain with independent weight, and stops pushing after weight is removed", () => {
    const world = new World(1, 6);
    world.place(0, 0, TileKind.Stone);
    const upper = world.place(0, 1, TileKind.Floatstone);
    const lower = world.place(0, 2, TileKind.Floatstone);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(0, 2)).toBe(upper);
    expect(world.idAt(0, 3)).toBe(lower);
    world.place(0, 1, TileKind.Empty);
    simulation.step();
    expect(world.idAt(0, 2)).toBe(upper);
    expect(world.idAt(0, 3)).toBe(lower);
  });

  it("activates floating gravity after ordinary ticks and clears weight across removal and reset", () => {
    const world = new World(1, 6);
    world.place(0, 0, TileKind.Stone);
    const ordinary = world.clone();
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.kindAt(0, 1)).toBe(TileKind.Stone);

    world.place(0, 2, TileKind.Floatstone);
    const weighted = world.clone();
    simulation.step();
    expect(world.kindAt(0, 2)).toBe(TileKind.Stone);
    expect(world.kindAt(0, 3)).toBe(TileKind.Floatstone);

    world.place(0, 2, TileKind.Empty);
    simulation.step();
    expect(world.kindAt(0, 3)).toBe(TileKind.Floatstone);
    world.place(0, 3, TileKind.Empty);
    world.place(0, 0, TileKind.Stone);
    simulation.step();
    expect(world.kindAt(0, 1)).toBe(TileKind.Stone);
    world.place(0, 1, TileKind.Empty);
    world.place(0, 2, TileKind.Floatstone);
    simulation.step();
    expect(world.kindAt(0, 2)).toBe(TileKind.Floatstone);

    simulation.resetTo(weighted);
    simulation.step();
    expect(world.kindAt(0, 2)).toBe(TileKind.Stone);
    expect(world.kindAt(0, 3)).toBe(TileKind.Floatstone);
    simulation.resetTo(ordinary);
    simulation.step();
    expect(world.kindAt(0, 1)).toBe(TileKind.Stone);
    expect(world.kindAt(0, 3)).toBe(TileKind.Empty);
  });

  it("does not push from a body supported elsewhere", () => {
    const world = new World(2, 4);
    world.place(0, 0, TileKind.Stone);
    world.place(1, 0, TileKind.Stone);
    world.setWeld(0, 0, 1, 0, true);
    world.place(0, 1, TileKind.Platform);
    const floating = world.place(1, 1, TileKind.Floatstone);
    new Simulation(world).step();
    expect(world.idAt(1, 1)).toBe(floating);
    expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
  });

  it("jams the entire weighted chain against a platform or boundary", () => {
    for (const platform of [false, true]) {
      const world = new World(1, platform ? 4 : 3);
      const weight = world.place(0, 0, TileKind.Stone);
      world.place(0, 1, TileKind.Floatstone);
      const lower = world.place(0, 2, TileKind.Floatstone);
      if (platform) world.place(0, 3, TileKind.Platform);
      new Simulation(world).step();
      expect(world.idAt(0, 0)).toBe(weight);
      expect(world.idAt(0, 2)).toBe(lower);
    }
  });

  it("lets a piston push a floating welded load upward", () => {
    const world = new World(5, 6);
    world.place(2, 3, TileKind.Piston, Direction.Up);
    world.place(1, 3, TileKind.FixedCharge);
    world.place(2, 4, TileKind.Platform);
    world.setWeld(2, 3, 1, 3, true);
    world.setWeld(2, 3, 2, 4, true);
    const floating = world.place(2, 2, TileKind.Floatstone);
    const load = world.place(3, 2, TileKind.Stone);
    world.setWeld(2, 2, 3, 2, true);
    new Simulation(world).step();
    expect(world.idAt(2, 1)).toBe(floating);
    expect(world.idAt(3, 1)).toBe(load);
    expect(world.isWelded(2, 1, 3, 1)).toBe(true);
  });

  it("allows upward conveyor motion without moving the fixed conveyor", () => {
    const world = new World(4, 5);
    world.place(1, 2, TileKind.Conveyor);
    world.place(1, 3, TileKind.FixedCharge);
    world.place(1, 4, TileKind.Platform);
    world.setWeld(1, 2, 1, 3, true);
    world.setWeld(1, 3, 1, 4, true);
    const floating = world.place(0, 2, TileKind.Floatstone);
    new Simulation(world).step();
    expect(world.idAt(0, 1)).toBe(floating);
    expect(world.kindAt(1, 2)).toBe(TileKind.Conveyor);
  });

  it("allows a rotator to carry floatstone", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    world.place(3, 4, TileKind.FixedCharge);
    world.place(3, 5, TileKind.Platform);
    world.setWeld(3, 3, 3, 4, true);
    world.setWeld(3, 4, 3, 5, true);
    const floating = world.place(3, 2, TileKind.Floatstone);
    new Simulation(world).step();
    expect(world.idAt(4, 3)).toBe(floating);
  });
});
