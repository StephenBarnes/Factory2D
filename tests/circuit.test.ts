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

  it.each([
    Direction.Up,
    Direction.Right,
    Direction.Down,
    Direction.Left,
  ])("keeps a %s-facing sensor's front circuit port isolated", (orientation) => {
    const world = new World(3, 3);
    world.place(1, 1, TileKind.Sensor, orientation);
    world.place(1, 0, TileKind.Conduit);
    world.place(2, 1, TileKind.Conduit);
    world.place(1, 2, TileKind.Conduit);
    world.place(0, 1, TileKind.Conduit);
    world.setWeld(1, 1, 1, 0, true);
    world.setWeld(1, 1, 2, 1, true);
    world.setWeld(1, 1, 1, 2, true);
    world.setWeld(1, 1, 0, 1, true);
    const sensorIndex = 1 * world.width + 1;

    for (let value = Direction.Up; value <= Direction.Left; value += 1) {
      const direction = value as Direction;
      expect(world.hasCircuitConnectionAtIndex(sensorIndex, direction)).toBe(
        direction !== orientation,
      );
    }
  });

  it("moves the resolved charge with an unsupported welded circuit body", () => {
    const world = new World(2, 4);
    world.place(0, 0, TileKind.Sensor, Direction.Right);
    world.place(1, 0, TileKind.Stone);
    world.place(0, 1, TileKind.Conduit);
    world.place(1, 1, TileKind.Platform);
    world.setWeld(0, 0, 0, 1, true);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);

    expect(world.chargeAt(0, 0)).toBe(0);
    expect(world.chargeAt(0, 1)).toBe(1);
    expect(world.chargeAt(0, 2)).toBe(1);
    expect(world.isWelded(0, 1, 0, 2)).toBe(true);
  });

  it("connects an inverter only through its rotated input and output ports", () => {
    const world = new World(3, 3);
    world.place(1, 1, TileKind.Inverter, Direction.Right);
    world.place(1, 0, TileKind.Conduit);
    world.place(2, 1, TileKind.Conduit);
    world.place(1, 2, TileKind.Conduit);
    world.place(0, 1, TileKind.Conduit);
    world.setWeld(1, 1, 1, 0, true);
    world.setWeld(1, 1, 2, 1, true);
    world.setWeld(1, 1, 1, 2, true);
    world.setWeld(1, 1, 0, 1, true);
    const inverterIndex = 1 * world.width + 1;

    expect(world.hasCircuitConnectionAtIndex(inverterIndex, Direction.Up)).toBe(false);
    expect(world.hasCircuitConnectionAtIndex(inverterIndex, Direction.Right)).toBe(true);
    expect(world.hasCircuitConnectionAtIndex(inverterIndex, Direction.Down)).toBe(false);
    expect(world.hasCircuitConnectionAtIndex(inverterIndex, Direction.Left)).toBe(true);
  });

  it.each([
    { input: -1 as const, output: 1 as const },
    { input: 0 as const, output: 0 as const },
    { input: 1 as const, output: -1 as const },
  ])("negates a start-of-tick $input charge across isolated networks", ({ input, output }) => {
    const world = new World(4, 1);
    world.place(0, 0, TileKind.Conduit);
    world.place(1, 0, TileKind.Inverter, Direction.Right);
    world.place(2, 0, TileKind.Conduit);
    world.place(3, 0, TileKind.Conduit);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 2, 0, true);
    world.setWeld(2, 0, 3, 0, true);
    world.setCharge(0, 0, input);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.chargeAt(0, 0)).toBe(0);
    expect(world.chargeAt(1, 0)).toBe(output);
    expect(world.chargeAt(2, 0)).toBe(output);
    expect(world.chargeAt(3, 0)).toBe(output);
  });

  it("delays each inverter in a directly connected gate chain by one tick", () => {
    const world = new World(4, 1);
    world.place(0, 0, TileKind.Conduit);
    world.place(1, 0, TileKind.Inverter, Direction.Right);
    world.place(2, 0, TileKind.Inverter, Direction.Right);
    world.place(3, 0, TileKind.Conduit);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 2, 0, true);
    world.setWeld(2, 0, 3, 0, true);
    world.setCharge(0, 0, 1);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.chargeAt(1, 0)).toBe(-1);
    expect(world.chargeAt(2, 0)).toBe(0);
    expect(world.chargeAt(3, 0)).toBe(0);

    simulation.step();

    expect(world.chargeAt(1, 0)).toBe(0);
    expect(world.chargeAt(2, 0)).toBe(1);
    expect(world.chargeAt(3, 0)).toBe(1);
  });

  it.each([
    { input: -1 as const, output: -1 as const },
    { input: 0 as const, output: 0 as const },
    { input: 1 as const, output: 1 as const },
  ])("forwards a start-of-tick $input charge through a diode", ({ input, output }) => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.Conduit);
    world.place(1, 0, TileKind.Diode, Direction.Right);
    world.place(2, 0, TileKind.Conduit);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 2, 0, true);
    world.setCharge(0, 0, input);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.chargeAt(0, 0)).toBe(0);
    expect(world.chargeAt(1, 0)).toBe(output);
    expect(world.chargeAt(2, 0)).toBe(output);
  });

  it("rotates a sum rune's two isolated inputs and pointed output", () => {
    const world = new World(3, 3);
    world.place(1, 1, TileKind.Sum, Direction.Right);
    world.place(1, 0, TileKind.Conduit);
    world.place(2, 1, TileKind.Conduit);
    world.place(1, 2, TileKind.Conduit);
    world.place(0, 1, TileKind.Conduit);
    world.setWeld(1, 1, 1, 0, true);
    world.setWeld(1, 1, 2, 1, true);
    world.setWeld(1, 1, 1, 2, true);
    world.setWeld(1, 1, 0, 1, true);
    const sumIndex = 1 * world.width + 1;

    expect(world.hasCircuitConnectionAtIndex(sumIndex, Direction.Up)).toBe(true);
    expect(world.hasCircuitConnectionAtIndex(sumIndex, Direction.Right)).toBe(true);
    expect(world.hasCircuitConnectionAtIndex(sumIndex, Direction.Down)).toBe(true);
    expect(world.hasCircuitConnectionAtIndex(sumIndex, Direction.Left)).toBe(false);
  });

  it.each([
    { first: -1 as const, second: -1 as const, output: -1 as const },
    { first: -1 as const, second: 0 as const, output: -1 as const },
    { first: -1 as const, second: 1 as const, output: 0 as const },
    { first: 0 as const, second: -1 as const, output: -1 as const },
    { first: 0 as const, second: 0 as const, output: 0 as const },
    { first: 0 as const, second: 1 as const, output: 1 as const },
    { first: 1 as const, second: -1 as const, output: 0 as const },
    { first: 1 as const, second: 0 as const, output: 1 as const },
    { first: 1 as const, second: 1 as const, output: 1 as const },
  ])(
    "resolves signed sum inputs $first and $second to $output",
    ({ first, second, output }) => {
      const world = new World(3, 2);
      world.place(1, 0, TileKind.Conduit);
      world.place(0, 1, TileKind.Conduit);
      world.place(1, 1, TileKind.Sum, Direction.Up);
      world.place(2, 1, TileKind.Conduit);
      world.setWeld(1, 0, 1, 1, true);
      world.setWeld(0, 1, 1, 1, true);
      world.setWeld(1, 1, 2, 1, true);
      world.setCharge(0, 1, first);
      world.setCharge(2, 1, second);
      const simulation = new Simulation(world);

      simulation.step();

      expect(world.chargeAt(0, 1)).toBe(0);
      expect(world.chargeAt(2, 1)).toBe(0);
      expect(world.chargeAt(1, 1)).toBe(output);
      expect(world.chargeAt(1, 0)).toBe(output);
    },
  );
});
