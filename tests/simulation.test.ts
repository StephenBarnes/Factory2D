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
    world.place(0, 2, TileKind.Stone);
    world.place(1, 2, TileKind.Sand);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);
    expect(world.kindAt(0, 1)).toBe(TileKind.Sand);
    expect(world.kindAt(1, 2)).toBe(TileKind.Sand);
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

describe("world editing", () => {
  it("assigns stable nonzero IDs and does not replace an unchanged tile", () => {
    const world = new World(2, 1);
    const firstId = world.place(0, 0, TileKind.Stone);

    expect(firstId).toBeGreaterThan(0);
    expect(world.place(0, 0, TileKind.Stone)).toBe(firstId);
    expect(world.place(0, 0, TileKind.Sand)).not.toBe(firstId);
  });
});
