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

  it("connects an inverter through its rotated isolated inputs and pointed output", () => {
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

    for (let value = Direction.Up; value <= Direction.Left; value += 1) {
      expect(
        world.hasCircuitConnectionAtIndex(inverterIndex, value as Direction),
      ).toBe(true);
    }
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

  it.each(
    ([-1, 0, 1] as const).flatMap((left) =>
      ([-1, 0, 1] as const).flatMap((rear) =>
        ([-1, 0, 1] as const).map((right) => {
          const negatedSum = -(left + rear + right);
          return {
            left,
            rear,
            right,
            output: negatedSum < 0 ? -1 : negatedSum > 0 ? 1 : 0,
          };
        }),
      ),
    ),
  )(
    "negates three isolated inputs −($left + $rear + $right) to $output",
    ({ left, rear, right, output }) => {
      const world = new World(3, 3);
      world.place(1, 0, TileKind.Conduit);
      world.place(0, 1, TileKind.Conduit);
      world.place(1, 1, TileKind.Inverter, Direction.Up);
      world.place(2, 1, TileKind.Conduit);
      world.place(1, 2, TileKind.Conduit);
      world.setWeld(1, 0, 1, 1, true);
      world.setWeld(0, 1, 1, 1, true);
      world.setWeld(1, 1, 2, 1, true);
      world.setWeld(1, 1, 1, 2, true);
      world.setCharge(0, 1, left);
      world.setCharge(1, 2, rear);
      world.setCharge(2, 1, right);
      const simulation = new Simulation(world);

      simulation.step();

      expect(world.chargeAt(0, 1)).toBe(0);
      expect(world.chargeAt(1, 2)).toBe(0);
      expect(world.chargeAt(2, 1)).toBe(0);
      expect(world.chargeAt(1, 1)).toBe(output);
      expect(world.chargeAt(1, 0)).toBe(output);
    },
  );

  it.each(
    ([-1, 0, 1] as const).flatMap((left) =>
      ([-1, 0, 1] as const).flatMap((rear) =>
        ([-1, 0, 1] as const).map((right) => ({
          left,
          rear,
          right,
          output: left + rear + right > 0 ? 1 : 0,
        })),
      ),
    ),
  )(
    "rectifies three isolated inputs max(0, sign($left + $rear + $right)) to $output",
    ({ left, rear, right, output }) => {
      const world = new World(3, 3);
      world.place(1, 0, TileKind.Conduit);
      world.place(0, 1, TileKind.Conduit);
      world.place(1, 1, TileKind.Rectifier, Direction.Up);
      world.place(2, 1, TileKind.Conduit);
      world.place(1, 2, TileKind.Conduit);
      world.setWeld(1, 0, 1, 1, true);
      world.setWeld(0, 1, 1, 1, true);
      world.setWeld(1, 1, 2, 1, true);
      world.setWeld(1, 1, 1, 2, true);
      world.setCharge(0, 1, left);
      world.setCharge(1, 2, rear);
      world.setCharge(2, 1, right);
      const simulation = new Simulation(world);

      simulation.step();

      expect(world.chargeAt(0, 1)).toBe(0);
      expect(world.chargeAt(1, 2)).toBe(0);
      expect(world.chargeAt(2, 1)).toBe(0);
      expect(world.chargeAt(1, 1)).toBe(output);
      expect(world.chargeAt(1, 0)).toBe(output);
    },
  );

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
  ])("combines a single connected input charge of $input", ({ input, output }) => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.Conduit);
    world.place(1, 0, TileKind.Combiner, Direction.Right);
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

  it("rotates a combiner's isolated inputs and pointed output", () => {
    const world = new World(3, 3);
    world.place(1, 1, TileKind.Combiner, Direction.Right);
    world.place(1, 0, TileKind.Conduit);
    world.place(2, 1, TileKind.Conduit);
    world.place(1, 2, TileKind.Conduit);
    world.place(0, 1, TileKind.Conduit);
    world.setWeld(1, 1, 1, 0, true);
    world.setWeld(1, 1, 2, 1, true);
    world.setWeld(1, 1, 1, 2, true);
    world.setWeld(1, 1, 0, 1, true);
    const combinerIndex = 1 * world.width + 1;

    for (let value = Direction.Up; value <= Direction.Left; value += 1) {
      expect(
        world.hasCircuitConnectionAtIndex(combinerIndex, value as Direction),
      ).toBe(true);
    }
  });

  it.each(
    ([-1, 0, 1] as const).flatMap((left) =>
      ([-1, 0, 1] as const).flatMap((rear) =>
        ([-1, 0, 1] as const).map((right) => {
          const sum = left + rear + right;
          return { left, rear, right, output: sum < 0 ? -1 : sum > 0 ? 1 : 0 };
        }),
      ),
    ),
  )(
    "resolves three isolated inputs $left + $rear + $right to $output",
    ({ left, rear, right, output }) => {
      const world = new World(3, 3);
      world.place(1, 0, TileKind.Conduit);
      world.place(0, 1, TileKind.Conduit);
      world.place(1, 1, TileKind.Combiner, Direction.Up);
      world.place(2, 1, TileKind.Conduit);
      world.place(1, 2, TileKind.Conduit);
      world.setWeld(1, 0, 1, 1, true);
      world.setWeld(0, 1, 1, 1, true);
      world.setWeld(1, 1, 2, 1, true);
      world.setWeld(1, 1, 1, 2, true);
      world.setCharge(0, 1, left);
      world.setCharge(1, 2, rear);
      world.setCharge(2, 1, right);
      const simulation = new Simulation(world);

      simulation.step();

      expect(world.chargeAt(0, 1)).toBe(0);
      expect(world.chargeAt(1, 2)).toBe(0);
      expect(world.chargeAt(2, 1)).toBe(0);
      expect(world.chargeAt(1, 1)).toBe(output);
      expect(world.chargeAt(1, 0)).toBe(output);
    },
  );

  it.each(
    ([-1, 0, 1] as const).flatMap((left) =>
      ([-1, 0, 1] as const).flatMap((rear) =>
        ([-1, 0, 1] as const).map((right) => {
          const product = left * rear * right;
          return {
            left,
            rear,
            right,
            output: product < 0 ? -1 : product > 0 ? 1 : 0,
          };
        }),
      ),
    ),
  )(
    "multiplies three isolated inputs $left × $rear × $right to $output",
    ({ left, rear, right, output }) => {
      const world = new World(3, 3);
      world.place(1, 0, TileKind.Conduit);
      world.place(0, 1, TileKind.Conduit);
      world.place(1, 1, TileKind.Multiplier, Direction.Up);
      world.place(2, 1, TileKind.Conduit);
      world.place(1, 2, TileKind.Conduit);
      world.setWeld(1, 0, 1, 1, true);
      world.setWeld(0, 1, 1, 1, true);
      world.setWeld(1, 1, 2, 1, true);
      world.setWeld(1, 1, 1, 2, true);
      world.setCharge(0, 1, left);
      world.setCharge(1, 2, rear);
      world.setCharge(2, 1, right);
      const simulation = new Simulation(world);

      simulation.step();

      expect(world.chargeAt(0, 1)).toBe(0);
      expect(world.chargeAt(1, 2)).toBe(0);
      expect(world.chargeAt(2, 1)).toBe(0);
      expect(world.chargeAt(1, 1)).toBe(output);
      expect(world.chargeAt(1, 0)).toBe(output);
    },
  );

  it("multiplies only inputs with circuit connections", () => {
    const world = new World(3, 2);
    world.place(1, 0, TileKind.Conduit);
    world.place(0, 1, TileKind.Conduit);
    world.place(1, 1, TileKind.Multiplier, Direction.Up);
    world.place(2, 1, TileKind.Stone);
    world.setWeld(1, 0, 1, 1, true);
    world.setWeld(0, 1, 1, 1, true);
    world.setWeld(1, 1, 2, 1, true);
    world.setCharge(0, 1, -1);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.chargeAt(1, 1)).toBe(-1);
    expect(world.chargeAt(1, 0)).toBe(-1);
  });

  it.each(
    ([-1, 0, 1] as const).flatMap((left) =>
      ([-1, 0, 1] as const).flatMap((rear) =>
        ([-1, 0, 1] as const).map((right) => {
          const difference = rear - left - right;
          return {
            left,
            rear,
            right,
            output: difference < 0 ? -1 : difference > 0 ? 1 : 0,
          };
        }),
      ),
    ),
  )(
    "subtracts isolated inputs sign($rear − $left − $right) to $output",
    ({ left, rear, right, output }) => {
      const world = new World(3, 3);
      world.place(1, 0, TileKind.Conduit);
      world.place(0, 1, TileKind.Conduit);
      world.place(1, 1, TileKind.Subtractor, Direction.Up);
      world.place(2, 1, TileKind.Conduit);
      world.place(1, 2, TileKind.Conduit);
      world.setWeld(1, 0, 1, 1, true);
      world.setWeld(0, 1, 1, 1, true);
      world.setWeld(1, 1, 2, 1, true);
      world.setWeld(1, 1, 1, 2, true);
      world.setCharge(0, 1, left);
      world.setCharge(1, 2, rear);
      world.setCharge(2, 1, right);
      const simulation = new Simulation(world);

      simulation.step();

      expect(world.chargeAt(0, 1)).toBe(0);
      expect(world.chargeAt(1, 2)).toBe(0);
      expect(world.chargeAt(2, 1)).toBe(0);
      expect(world.chargeAt(1, 1)).toBe(output);
      expect(world.chargeAt(1, 0)).toBe(output);
    },
  );
});
