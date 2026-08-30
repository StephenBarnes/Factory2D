import { describe, expect, it } from "vitest";

import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("circuit networks", () => {
  it("propagates a sensor charge across every welded conduit in one tick", () => {
    const world = new World(5, 2);
    world.place(0, 0, TileKind.Stone);
    world.place(0, 1, TileKind.Sensor, Direction.Up);
    world.place(1, 1, TileKind.Conduit);
    world.place(2, 1, TileKind.Conduit);
    world.place(3, 1, TileKind.Conduit);
    world.setWeld(0, 1, 1, 1, true);
    world.setWeld(1, 1, 2, 1, true);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.chargeAt(0, 1)).toBe(1);
    expect(world.chargeAt(1, 1)).toBe(1);
    expect(world.chargeAt(2, 1)).toBe(1);
    expect(world.chargeAt(3, 1)).toBe(0);
  });

  it("clears an undriven conduit on the tick after its sensor is unwelded", () => {
    const world = new World(2, 2);
    world.place(0, 0, TileKind.Stone);
    world.place(0, 1, TileKind.Sensor, Direction.Up);
    world.place(1, 1, TileKind.Conduit);
    world.setWeld(0, 1, 1, 1, true);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.chargeAt(1, 1)).toBe(1);

    world.setWeld(0, 1, 1, 1, false);
    simulation.step();

    expect(world.chargeAt(0, 1)).toBe(1);
    expect(world.chargeAt(1, 1)).toBe(0);
  });

  it("observes only the sensor's pointed neighboring cell", () => {
    const world = new World(3, 2);
    world.place(0, 1, TileKind.Stone);
    world.place(1, 1, TileKind.Sensor, Direction.Up);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.chargeAt(1, 1)).toBe(0);

    world.place(1, 0, TileKind.Stone);
    simulation.step();
    expect(world.chargeAt(1, 1)).toBe(1);
  });

  it("moves the resolved charge with an unsupported welded circuit body", () => {
    const world = new World(2, 3);
    world.place(0, 0, TileKind.Sensor, Direction.Right);
    world.place(1, 0, TileKind.Conduit);
    world.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);

    expect(world.chargeAt(0, 0)).toBe(0);
    expect(world.chargeAt(1, 0)).toBe(0);
    expect(world.chargeAt(0, 1)).toBe(1);
    expect(world.chargeAt(1, 1)).toBe(1);
    expect(world.isWelded(0, 1, 1, 1)).toBe(true);
  });
});
