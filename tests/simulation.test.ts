import { describe, expect, it } from "vitest";

import { Simulation } from "../src/simulation/simulation";
import { TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("gravity simulation", () => {
  it("moves sand down exactly one cell per tick and preserves its identity", () => {
    const world = new World(3, 4);
    const sandId = world.place(1, 0, TileKind.Sand);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(1);
    expect(world.tileAt(1, 0)).toEqual({ kind: TileKind.Empty, id: 0 });
    expect(world.tileAt(1, 1)).toEqual({ kind: TileKind.Sand, id: sandId });
    expect(simulation.tick).toBe(1);
  });

  it("makes all decisions from the start-of-tick state", () => {
    const world = new World(1, 4);
    const upperId = world.place(0, 0, TileKind.Sand);
    const lowerId = world.place(0, 1, TileKind.Sand);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(1);
    expect(world.idAt(0, 0)).toBe(upperId);
    expect(world.kindAt(0, 1)).toBe(TileKind.Empty);
    expect(world.idAt(0, 2)).toBe(lowerId);
  });

  it("does not move sand through fixed blocks or the world boundary", () => {
    const world = new World(2, 3);
    world.place(0, 1, TileKind.Sand);
    world.place(0, 2, TileKind.Platform);
    world.place(1, 2, TileKind.Sand);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);
    expect(world.kindAt(0, 1)).toBe(TileKind.Sand);
    expect(world.kindAt(1, 2)).toBe(TileKind.Sand);
  });

  it("moves stone down while a fixed platform stays in place", () => {
    const world = new World(2, 3);
    world.place(0, 0, TileKind.Stone);
    world.place(1, 0, TileKind.Platform);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(1);
    expect(world.kindAt(0, 1)).toBe(TileKind.Stone);
    expect(world.kindAt(1, 0)).toBe(TileKind.Platform);
  });

  it("does not slide stone diagonally around an obstacle", () => {
    const world = new World(3, 3);
    world.place(1, 0, TileKind.Stone);
    world.place(1, 1, TileKind.Platform);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);
    expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
  });

  it("resets both world state and tick count to an edited snapshot", () => {
    const world = new World(1, 3);
    world.place(0, 0, TileKind.Sand);
    const snapshot = world.clone();
    const simulation = new Simulation(world);
    simulation.step();

    simulation.resetTo(snapshot);

    expect(simulation.tick).toBe(0);
    expect(world.kindAt(0, 0)).toBe(TileKind.Sand);
    expect(world.kindAt(0, 1)).toBe(TileKind.Empty);
  });
});

describe("diagonal sand gravity", () => {
  it("uses coordinate and tick parity to choose between open lower diagonals", () => {
    const evenTickWorld = new World(3, 3);
    evenTickWorld.place(1, 0, TileKind.Sand);
    evenTickWorld.place(1, 1, TileKind.Platform);
    const evenTickSimulation = new Simulation(evenTickWorld);

    expect(evenTickSimulation.step()).toBe(1);
    expect(evenTickWorld.kindAt(2, 1)).toBe(TileKind.Sand);

    const oddTickWorld = new World(3, 3);
    oddTickWorld.place(1, 0, TileKind.Sand);
    oddTickWorld.place(1, 1, TileKind.Platform);
    const oddTickSimulation = new Simulation(oddTickWorld);
    oddTickSimulation.tick = 1;

    expect(oddTickSimulation.step()).toBe(1);
    expect(oddTickWorld.kindAt(0, 1)).toBe(TileKind.Sand);
  });

  it("falls through the other lower diagonal when the preferred side is blocked", () => {
    const world = new World(3, 3);
    world.place(1, 0, TileKind.Sand);
    world.place(1, 1, TileKind.Platform);
    world.place(2, 1, TileKind.Platform);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(1);
    expect(world.kindAt(0, 1)).toBe(TileKind.Sand);
  });

  it("jams equal-priority diagonal moves that claim the same cell", () => {
    const world = new World(3, 3);
    world.place(0, 0, TileKind.Sand);
    world.place(2, 0, TileKind.Sand);
    world.place(0, 1, TileKind.Platform);
    world.place(2, 1, TileKind.Platform);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);
    expect(world.kindAt(0, 0)).toBe(TileKind.Sand);
    expect(world.kindAt(2, 0)).toBe(TileKind.Sand);
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
  });

  it("lets unsupported overhangs fall before blocked sand can move diagonally", () => {
    const world = new World(7, 4);
    for (let x = 1; x <= 5; x += 1) {
      world.place(x, 1, TileKind.Sand);
    }
    for (let x = 2; x <= 4; x += 1) {
      world.place(x, 2, TileKind.Platform);
    }
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);
    expect(world.kindAt(1, 2)).toBe(TileKind.Sand);
    expect(world.kindAt(5, 2)).toBe(TileKind.Sand);
    expect(world.kindAt(2, 1)).toBe(TileKind.Sand);
    expect(world.kindAt(4, 1)).toBe(TileKind.Sand);
  });
});

describe("welded bodies", () => {
  it("moves welded sand as one body while preserving IDs and the weld", () => {
    const world = new World(3, 3);
    const leftId = world.place(0, 0, TileKind.Sand);
    const rightId = world.place(1, 0, TileKind.Sand);
    expect(world.setWeld(0, 0, 1, 0, true)).toBe(true);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);
    expect(world.idAt(0, 1)).toBe(leftId);
    expect(world.idAt(1, 1)).toBe(rightId);
    expect(world.isWelded(0, 1, 1, 1)).toBe(true);
  });

  it("moves overlapping destinations in a vertical welded body", () => {
    const world = new World(1, 4);
    const upperId = world.place(0, 0, TileKind.Sand);
    const lowerId = world.place(0, 1, TileKind.Sand);
    world.setWeld(0, 0, 0, 1, true);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);
    expect(world.idAt(0, 1)).toBe(upperId);
    expect(world.idAt(0, 2)).toBe(lowerId);
    expect(world.isWelded(0, 1, 0, 2)).toBe(true);
  });

  it("does not move a body containing a fixed block", () => {
    const world = new World(2, 3);
    world.place(0, 0, TileKind.Sand);
    world.place(1, 0, TileKind.Platform);
    world.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);
    expect(world.kindAt(0, 0)).toBe(TileKind.Sand);
    expect(world.kindAt(1, 0)).toBe(TileKind.Platform);
  });
});

describe("world editing", () => {
  it("assigns stable nonzero IDs and does not replace an unchanged tile", () => {
    const world = new World(2, 1);
    const firstId = world.place(0, 0, TileKind.Stone);

    expect(firstId).toBeGreaterThan(0);
    expect(world.place(0, 0, TileKind.Stone)).toBe(firstId);
    expect(world.place(0, 0, TileKind.Sand)).not.toBe(firstId);
  });

  it("creates welds only between occupied neighbors and clears incident welds with a tile", () => {
    const world = new World(2, 2);
    world.place(0, 0, TileKind.Stone);

    expect(world.setWeld(0, 0, 1, 0, true)).toBe(false);
    world.place(1, 0, TileKind.Stone);
    expect(world.setWeld(0, 0, 1, 0, true)).toBe(true);
    expect(world.isWelded(0, 0, 1, 0)).toBe(true);
    expect(world.clone().isWelded(0, 0, 1, 0)).toBe(true);

    world.place(1, 0, TileKind.Empty);
    expect(world.isWelded(0, 0, 1, 0)).toBe(false);
  });
});
