import { describe, expect, it } from "vitest";
import { expectDefined } from "../src/util/assert";

import { CircuitResolver } from "../src/simulation/circuit-resolver";
import { Simulation } from "../src/simulation/simulation";
import { Direction, directionX, directionY, oppositeDirection, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";
import { WorldRuntime } from "../src/simulation/world-runtime";

type GateInput = {
  readonly direction: Direction.Right | Direction.Down | Direction.Left;
  readonly charge: -1 | 0 | 1;
};

function resolveGateOutput(kind: TileKind, inputs: readonly GateInput[]): -1 | 0 | 1 {
  const world = new World(3, 3);
  world.place(1, 0, TileKind.Conduit);
  world.place(1, 1, kind, Direction.Up);
  world.setWeld(1, 0, 1, 1, true);
  for (const input of inputs) {
    const x = input.direction === Direction.Left
      ? 0
      : input.direction === Direction.Right
        ? 2
        : 1;
    const y = input.direction === Direction.Down ? 2 : 1;
    world.place(x, y, TileKind.Conduit);
    world.setWeld(1, 1, x, y, true);
    world.setCharge(x, y, input.charge);
  }

  new Simulation(world).step();

  return world.chargeAt(1, 1);
}

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

  it("activates circuits after empty ticks and reuses the runtime across resets", () => {
    const world = new World(3, 1);
    const empty = world.clone();
    const simulation = new Simulation(world);
    simulation.step();

    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.Conduit);
    world.setWeld(0, 0, 1, 0, true);
    const powered = world.clone();
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(1);

    world.setWeld(0, 0, 1, 0, false);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);

    simulation.resetTo(empty);
    simulation.step();
    world.place(1, 0, TileKind.Conduit);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);

    simulation.resetTo(powered);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(1);
  });

  it("drives a welded circuit with +1 constantly", () => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.Conduit);
    world.place(2, 0, TileKind.Conduit);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 2, 0, true);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.chargeAt(0, 0)).toBe(1);
    expect(world.chargeAt(1, 0)).toBe(1);
    expect(world.chargeAt(2, 0)).toBe(1);

    world.setWeld(0, 0, 1, 0, false);
    simulation.step();

    expect(world.chargeAt(0, 0)).toBe(1);
    expect(world.chargeAt(1, 0)).toBe(0);
    expect(world.chargeAt(2, 0)).toBe(0);
  });

  it("emits a one-tick spark pulse again after resetting", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Spark);
    world.place(1, 0, TileKind.Conduit);
    world.setWeld(0, 0, 1, 0, true);
    const initialWorld = world.clone();
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.chargeAt(0, 0)).toBe(1);
    expect(world.chargeAt(1, 0)).toBe(1);

    simulation.step();
    expect(world.chargeAt(0, 0)).toBe(0);
    expect(world.chargeAt(1, 0)).toBe(0);

    simulation.resetTo(initialWorld);
    simulation.step();
    expect(world.chargeAt(0, 0)).toBe(1);
    expect(world.chargeAt(1, 0)).toBe(1);
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

  it("ignores glass without sensing through it, then detects its replacement", () => {
    const world = new World(4, 1);
    world.place(0, 0, TileKind.Conduit);
    world.place(1, 0, TileKind.Sensor, Direction.Right);
    world.place(2, 0, TileKind.Glass);
    world.place(3, 0, TileKind.Stone);
    world.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.chargeAt(0, 0)).toBe(0);
    expect(world.tileAt(2, 0).kind).toBe(TileKind.Glass);

    world.place(2, 0, TileKind.Stone);
    simulation.step();
    expect(world.chargeAt(0, 0)).toBe(1);

    world.place(2, 0, TileKind.Glass);
    simulation.step();
    expect(world.chargeAt(0, 0)).toBe(0);
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

  it.each([-1, 0, 1] as const)(
    "copies an unwelded rotated front input charge of %s to three isolated outputs",
    (input) => {
      const world = new World(3, 3);
      world.place(1, 0, TileKind.Conduit);
      world.place(0, 1, TileKind.Conduit);
      world.place(1, 1, TileKind.ChargeSensor, Direction.Right);
      world.place(2, 1, TileKind.Conduit);
      world.place(1, 2, TileKind.Conduit);
      world.place(2, 2, TileKind.Platform);
      world.setWeld(1, 0, 1, 1, true);
      world.setWeld(0, 1, 1, 1, true);
      world.setWeld(1, 1, 1, 2, true);
      world.setCharge(2, 1, input);
      const sensorIndex = 1 * world.width + 1;
      expect(world.hasCircuitConnectionAtIndex(sensorIndex, Direction.Right)).toBe(false);
      const simulation = new Simulation(world);

      simulation.step();

      expect(world.chargeAt(2, 1)).toBe(0);
      expect(world.chargeAt(1, 1)).toBe(input);
      expect(world.chargeAt(1, 0)).toBe(input);
      expect(world.chargeAt(0, 1)).toBe(input);
      expect(world.chargeAt(1, 2)).toBe(input);
    },
  );

  it.each([Direction.Up, Direction.Right, Direction.Down, Direction.Left])(
    "senses through a %s-facing weld without making a circuit connection",
    (orientation) => {
      const world = new World(3, 3);
      world.place(1, 1, TileKind.ChargeSensor, orientation);
      for (const side of [Direction.Up, Direction.Right, Direction.Down, Direction.Left]) {
        const x = 1 + directionX(side);
        const y = 1 + directionY(side);
        world.place(x, y, TileKind.Conduit);
        world.setWeld(1, 1, x, y, true);
        expect(world.isWelded(1, 1, x, y)).toBe(true);
        expect(world.hasCircuitConnectionAtIndex(4, side)).toBe(side !== orientation);
        expect(world.hasCircuitConnectionAtIndex(y * 3 + x, oppositeDirection(side)))
          .toBe(side !== orientation);
      }
      world.place(0, 2, TileKind.Platform);
      world.setWeld(0, 2, 1, 2, true);
      world.setCharge(1 + directionX(orientation), 1 + directionY(orientation), -1);

      new Simulation(world).step();

      for (const side of [Direction.Up, Direction.Right, Direction.Down, Direction.Left]) {
        expect(world.chargeAt(1 + directionX(side), 1 + directionY(side)))
          .toBe(side === orientation ? 0 : -1);
      }
    },
  );

  it.each([Direction.Up, Direction.Right, Direction.Down, Direction.Left])(
    "senses the first distant tile's old charge in direction %s",
    (orientation) => {
      const world = new World(9, 9);
      const dx = directionX(orientation);
      const dy = directionY(orientation);
      world.place(4, 4, TileKind.ChargeSensor, orientation);
      world.place(4 - dx, 4 - dy, TileKind.Conduit);
      world.setWeld(4, 4, 4 - dx, 4 - dy, true);
      world.place(4 + dx * 3, 4 + dy * 3, TileKind.Conduit);
      world.setCharge(4 + dx * 3, 4 + dy * 3, -1);
      world.place(4 + dx * 4, 4 + dy * 4, TileKind.FixedCharge);
      world.setCharge(4 + dx * 4, 4 + dy * 4, 1);
      const runtime = new WorldRuntime(world);
      const resolver = new CircuitResolver();

      resolver.resolve(0, [runtime]);

      expect(world.chargeAt(4 - dx, 4 - dy)).toBe(-1);
      expect(world.chargeAt(4 + dx * 3, 4 + dy * 3)).toBe(0);
      resolver.resolve(1, [runtime]);
      expect(world.chargeAt(4 - dx, 4 - dy)).toBe(0);
    },
  );

  it("senses through glass and gaps, but stops at opaque tiles and reads neutral beyond glass", () => {
    const world = new World(8, 1);
    world.place(0, 0, TileKind.ChargeSensor, Direction.Right);
    world.place(1, 0, TileKind.Glass);
    world.place(3, 0, TileKind.Glass);
    world.place(6, 0, TileKind.FixedCharge);
    world.setCharge(6, 0, 1);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.chargeAt(0, 0)).toBe(1);

    world.place(4, 0, TileKind.Stone);
    simulation.step();
    expect(world.chargeAt(0, 0)).toBe(0);

    world.place(4, 0, TileKind.Empty);
    world.place(6, 0, TileKind.Glass);
    simulation.step();
    expect(world.chargeAt(0, 0)).toBe(0);
  });

  it.each([TileKind.Stone, TileKind.Conduit])(
    "stops distance sensing at a neutral blocker of kind %s",
    (blocker) => {
      const world = new World(6, 1);
      world.place(0, 0, TileKind.ChargeSensor, Direction.Right);
      world.setCharge(0, 0, 1);
      world.place(3, 0, blocker);
      world.place(5, 0, TileKind.FixedCharge);
      world.setCharge(5, 0, 1);

      new Simulation(world).step();

      expect(world.chargeAt(0, 0)).toBe(0);
    },
  );

  it.each([
    { orientation: Direction.Left, expected: -1 },
    { orientation: Direction.Right, expected: 0 },
  ] as const)("reads the distant near-side port, not a gate's stored output ($orientation)", ({
    orientation, expected,
  }) => {
    const world = new World(5, 1);
    world.place(0, 0, TileKind.ChargeSensor, Direction.Right);
    world.place(4, 0, TileKind.Inverter, orientation);
    world.setCharge(4, 0, -1);

    new Simulation(world).step();

    expect(world.chargeAt(0, 0)).toBe(expected);
  });

  it("reads neutral at the board edge without wrapping a horizontal scan into another row", () => {
    const world = new World(5, 2);
    world.place(2, 1, TileKind.ChargeSensor, Direction.Left);
    world.setCharge(2, 1, 1);
    world.place(4, 0, TileKind.Conduit);
    world.setCharge(4, 0, -1);

    new Simulation(world).step();

    expect(world.chargeAt(2, 1)).toBe(0);
  });

  it("senses across glass and empty gaps inside and outside nested array ports", () => {
    const world = new World(5, 1);
    world.place(0, 0, TileKind.Conduit);
    world.setCharge(0, 0, -1);
    world.place(2, 0, TileKind.Glass);
    world.place(4, 0, TileKind.RuneArray);
    world.configureRuneArray(4, 0, 5, 1, "");
    const inner = world.runeArrayWorldAt(4, 0);
    inner.place(0, 0, TileKind.Glass);
    inner.place(3, 0, TileKind.RuneArray);
    inner.configureRuneArray(3, 0, 5, 1, "");
    const deepest = inner.runeArrayWorldAt(3, 0);
    deepest.place(1, 0, TileKind.Glass);
    deepest.place(3, 0, TileKind.ChargeSensor, Direction.Left);
    deepest.place(4, 0, TileKind.Conduit);
    deepest.setWeld(3, 0, 4, 0, true);
    const simulation = new Simulation(world);

    simulation.step();

    expect(deepest.chargeAt(4, 0)).toBe(-1);
    simulation.step();
    expect(deepest.chargeAt(4, 0)).toBe(0);
  });

  it("senses a virtual array port without electrically joining it", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.RuneArray);
    world.setWeld(0, 0, 1, 0, true);
    world.configureRuneArray(1, 0, 3, 1, "");
    const inner = world.runeArrayWorldAt(1, 0);
    inner.place(0, 0, TileKind.ChargeSensor, Direction.Left);
    inner.place(1, 0, TileKind.Conduit);
    inner.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(inner.chargeAt(1, 0)).toBe(0);
    simulation.step();
    expect(inner.chargeAt(1, 0)).toBe(1);
  });

  it("senses an unwelded outside neighbor through nested array ports using its old charge", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Conduit);
    world.setCharge(0, 0, -1);
    world.place(1, 0, TileKind.RuneArray);
    world.configureRuneArray(1, 0, 3, 1, "");
    const inner = world.runeArrayWorldAt(1, 0);
    inner.place(0, 0, TileKind.RuneArray);
    inner.configureRuneArray(0, 0, 3, 1, "");
    const deepest = inner.runeArrayWorldAt(0, 0);
    deepest.place(0, 0, TileKind.ChargeSensor, Direction.Left);
    deepest.place(1, 0, TileKind.Conduit);
    deepest.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.chargeAt(0, 0)).toBe(0);
    expect(deepest.chargeAt(1, 0)).toBe(-1);
    simulation.step();
    expect(deepest.chargeAt(1, 0)).toBe(0);
  });

  it("does not sense outside an array through a non-port wall cell", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Conduit);
    world.setCharge(0, 0, 1);
    world.place(1, 0, TileKind.RuneArray);
    world.configureRuneArray(1, 0, 3, 3, "");
    const inner = world.runeArrayWorldAt(1, 0);
    inner.place(0, 2, TileKind.ChargeSensor, Direction.Left);
    inner.place(1, 2, TileKind.Conduit);
    inner.setWeld(0, 2, 1, 2, true);

    new Simulation(world).step();

    expect(inner.chargeAt(1, 2)).toBe(0);
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

  it("does not read a directly welded gate's output through its input port", () => {
    const world = new World(2, 2);
    world.place(1, 0, TileKind.Multiplier, Direction.Right);
    world.place(0, 1, TileKind.FixedCharge);
    world.place(1, 1, TileKind.Combiner, Direction.Down);
    world.setWeld(1, 0, 1, 1, true);
    world.setWeld(0, 1, 1, 1, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);
    expect(world.chargeAt(1, 1)).toBe(0);

    simulation.step();
    expect(world.chargeAt(1, 1)).toBe(1);
    expect(world.chargeAtPort(1, 1, Direction.Up)).toBe(0);

    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);
    expect(world.chargeAt(1, 1)).toBe(1);

    // Turning the combiner's output toward the multiplier makes this a real gate chain.
    world.place(1, 1, TileKind.Combiner, Direction.Up);
    simulation.step();
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(1);
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
        ([-1, 0, 1] as const).map((right) => ({
          left,
          rear,
          right,
          output: left === rear && rear === right ? 1 : 0,
        })),
      ),
    ),
  )(
    "tests equality of isolated inputs $left, $rear, and $right as $output",
    ({ left, rear, right, output }) => {
      expect(resolveGateOutput(TileKind.Equality, [
        { direction: Direction.Left, charge: left },
        { direction: Direction.Down, charge: rear },
        { direction: Direction.Right, charge: right },
      ])).toBe(output);
    },
  );

  it.each(
    ([-1, 0, 1] as const).flatMap((left) =>
      ([-1, 0, 1] as const).flatMap((rear) =>
        ([-1, 0, 1] as const).map((right) => ({
          left,
          rear,
          right,
          output: Math.min(left, rear, right),
        })),
      ),
    ),
  )(
    "takes minimum of isolated inputs $left, $rear, and $right as $output",
    ({ left, rear, right, output }) => {
      expect(resolveGateOutput(TileKind.Minimum, [
        { direction: Direction.Left, charge: left },
        { direction: Direction.Down, charge: rear },
        { direction: Direction.Right, charge: right },
      ])).toBe(output);
    },
  );

  it.each(
    ([-1, 0, 1] as const).flatMap((left) =>
      ([-1, 0, 1] as const).flatMap((rear) =>
        ([-1, 0, 1] as const).map((right) => ({
          left,
          rear,
          right,
          output: Math.max(left, rear, right),
        })),
      ),
    ),
  )(
    "takes maximum of isolated inputs $left, $rear, and $right as $output",
    ({ left, rear, right, output }) => {
      expect(resolveGateOutput(TileKind.Maximum, [
        { direction: Direction.Left, charge: left },
        { direction: Direction.Down, charge: rear },
        { direction: Direction.Right, charge: right },
      ])).toBe(output);
    },
  );

  it.each([
    { kind: TileKind.Equality, charge: -1 as const, alone: 1, withZero: 0 },
    { kind: TileKind.Minimum, charge: 1 as const, alone: 1, withZero: 0 },
    { kind: TileKind.Maximum, charge: -1 as const, alone: -1, withZero: 0 },
  ])(
    "gate $kind ignores an absent side but includes a connected zero input",
    ({ kind, charge, alone, withZero }) => {
      const loneInput = [{ direction: Direction.Left as const, charge }];
      expect(resolveGateOutput(kind, loneInput)).toBe(alone);
      expect(resolveGateOutput(kind, [
        ...loneInput,
        { direction: Direction.Down, charge: 0 },
      ])).toBe(withZero);
    },
  );

  it.each([
    { kind: TileKind.Equality, output: 1 },
    { kind: TileKind.Minimum, output: 1 },
    { kind: TileKind.Maximum, output: -1 },
  ])("uses the empty-input identity for gate $kind", ({ kind, output }) => {
    expect(resolveGateOutput(kind, [])).toBe(output);
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
  it.each(
    ([-1, 0, 1] as const).flatMap((left) =>
      ([-1, 0, 1] as const).flatMap((rear) =>
        ([-1, 0, 1] as const).map((right) => ({
          left,
          rear,
          right,
          output: rear === 1 ? left : rear === -1 ? right : 0,
        })),
      ),
    ),
  )(
    "selects from isolated inputs with left $left, rear $rear, and right $right",
    ({ left, rear, right, output }) => {
      const world = new World(3, 3);
      world.place(1, 0, TileKind.Conduit);
      world.place(0, 1, TileKind.Conduit);
      world.place(1, 1, TileKind.Selector, Direction.Up);
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

  it("delays the rear input by its configured ring-buffer length", () => {
    const world = new World(1, 3);
    world.place(0, 0, TileKind.Conduit);
    world.place(0, 1, TileKind.Delay, Direction.Up);
    world.place(0, 2, TileKind.Conduit);
    world.setWeld(0, 0, 0, 1, true);
    world.setWeld(0, 1, 0, 2, true);
    world.configureNumericComponent(0, 1, 3);
    const simulation = new Simulation(world);
    const inputs = [1, -1, 0, 0, 0, 0] as const;
    const outputs = [0, 0, 0, 1, -1, 0] as const;

    for (let index = 0; index < inputs.length; index += 1) {
      world.setCharge(0, 2, expectDefined(inputs[index], "delay test input"));
      simulation.step();
      expect(world.chargeAt(0, 0)).toBe(outputs[index]);
    }

    expect(world.componentStateSnapshotAt(0, 1)).toEqual({
      type: "delay",
      length: 3,
      cursor: 0,
      data: [0, 0, 0],
    });
  });

  it("counts signed rear inputs and pulses with the wrap direction", () => {
    const world = new World(1, 3);
    world.place(0, 0, TileKind.Conduit);
    world.place(0, 1, TileKind.Counter, Direction.Up);
    world.place(0, 2, TileKind.Conduit);
    world.setWeld(0, 0, 0, 1, true);
    world.setWeld(0, 1, 0, 2, true);
    world.configureNumericComponent(0, 1, 3);
    const simulation = new Simulation(world);
    const inputs = [1, 1, 1, 0, -1, 1, -1, -1, -1, 0] as const;
    const outputs = [0, 0, 1, 0, -1, 1, -1, 0, 0, 0] as const;

    for (let index = 0; index < inputs.length; index += 1) {
      world.setCharge(0, 2, expectDefined(inputs[index], "counter test input"));
      simulation.step();
      expect(world.chargeAt(0, 0)).toBe(outputs[index]);
    }

    expect(world.componentStateSnapshotAt(0, 1)).toEqual({
      type: "counter",
      threshold: 3,
      count: 0,
    });
  });

  it("moves a ROM cursor in two dimensions and drives its two output sides", () => {
    const world = new World(3, 3);
    world.place(1, 0, TileKind.Conduit);
    world.place(0, 1, TileKind.Conduit);
    world.place(1, 1, TileKind.Rom, Direction.Up);
    world.place(2, 1, TileKind.Conduit);
    world.place(1, 2, TileKind.Conduit);
    world.setWeld(1, 0, 1, 1, true);
    world.setWeld(0, 1, 1, 1, true);
    world.setWeld(1, 1, 2, 1, true);
    world.setWeld(1, 1, 1, 2, true);
    world.configureTernaryGrid(1, 1, 2, 2, [0, 1, -1, 1]);
    const simulation = new Simulation(world);
    const horizontalInputs = [1, 0, -1, 0] as const;
    const verticalInputs = [0, 1, 0, -1] as const;
    const outputs = [1, -1, 1, 1] as const;

    for (let index = 0; index < horizontalInputs.length; index += 1) {
      world.setCharge(
        0,
        1,
        expectDefined(horizontalInputs[index], "ROM horizontal test input"),
      );
      world.setCharge(
        1,
        2,
        expectDefined(verticalInputs[index], "ROM vertical test input"),
      );
      simulation.step();
      expect(world.chargeAt(1, 0)).toBe(outputs[index]);
      expect(world.chargeAt(2, 1)).toBe(outputs[index]);
    }

    expect(world.componentStateSnapshotAt(1, 1)).toEqual({
      type: "rom",
      width: 2,
      height: 2,
      cursor: 3,
      wrapX: true, wrapY: true,
      values: [0, 1, -1, 1],
    });
  });

  it.each([
    { name: "horizontal", width: 3, height: 2, wrapX: true, wrapY: false,
      inputX: 0, inputY: 1, forward: 1, values: [0, 1, -1, 0, 1, -1] },
    { name: "vertical", width: 2, height: 3, wrapX: false, wrapY: true,
      inputX: 1, inputY: 2, forward: -1, values: [0, 0, 1, 1, -1, -1] },
  ] as const)("allows $name carries but stops before wrapping the other axis", (testCase) => {
    const world = new World(3, 3);
    world.place(1, 0, TileKind.Conduit);
    world.place(0, 1, TileKind.Conduit);
    world.place(1, 1, TileKind.Rom);
    world.place(2, 1, TileKind.Conduit);
    world.place(1, 2, TileKind.Conduit);
    world.setWeld(1, 0, 1, 1, true);
    world.setWeld(0, 1, 1, 1, true);
    world.setWeld(1, 1, 2, 1, true);
    world.setWeld(1, 1, 1, 2, true);
    world.configureTernaryGrid(
      1, 1, testCase.width, testCase.height, testCase.values, testCase,
    );
    const simulation = new Simulation(world);
    for (const sign of [1, -1] as const) {
      const expected = sign === 1 ? [1, -1, 0, 1, -1, -1] : [1, 0, -1, 1, 0, 0];
      for (const output of expected) {
        world.setCharge(testCase.inputX, testCase.inputY, sign * testCase.forward as -1 | 1);
        simulation.step();
        expect(world.chargeAt(1, 0)).toBe(output);
        expect(world.chargeAt(2, 1)).toBe(output);
      }
    }
  });

  it("ignores disabled edge crossings while still applying the other input horizontally first", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Rom);
    world.configureTernaryGrid(0, 0, 2, 2, [0, 1, -1, 0], { wrapX: false, wrapY: false });
    expect(world.advanceRomAtIndex(0, -1, 1)).toBe(-1); // Block left, move down.
    expect(world.advanceRomAtIndex(0, 1, 1)).toBe(0); // Move right, block down.
    expect(world.advanceRomAtIndex(0, 1, -1)).toBe(1); // Block right, move up.
    expect(world.advanceRomAtIndex(0, -1, -1)).toBe(0); // Move left, block up.
    world.configureTernaryGrid(0, 0, 2, 2, [0, 1, -1, 0], { wrapY: false });
    world.advanceRomAtIndex(0, 1, 0);
    expect(world.advanceRomAtIndex(0, 1, -1)).toBe(0); // Horizontal carry, then vertical move.
    expect(world.componentStateSnapshotAt(0, 0)).toMatchObject({ cursor: 0 });
  });

  it.each([
    {
      name: "clockwise quarter turn",
      turns: 1, horizontal: false, vertical: false,
      width: 3, height: 2, cursor: 1,
      values: [0, -1, 1, -1, 1, 0],
    },
    {
      name: "vertical reflection",
      turns: 0, horizontal: false, vertical: true,
      width: 2, height: 3, cursor: 2,
      values: [0, -1, -1, 1, 1, 0],
    },
    {
      name: "horizontal reflection followed by rotation",
      turns: 1, horizontal: true, vertical: false,
      width: 3, height: 2, cursor: 4,
      values: [-1, 1, 0, 0, -1, 1],
    },
  ])("transforms a rectangular ROM grid and live cursor: $name", (testCase) => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Rom);
    world.restoreComponentState(0, 0, {
      type: "rom", width: 2, height: 3, cursor: 2,
      wrapX: true, wrapY: true,
      values: [1, 0, -1, 1, 0, -1],
    });

    const transformed = world.transformed(
      testCase.turns, testCase.horizontal, testCase.vertical,
    );
    expect(transformed.componentStateSnapshotAt(0, 0)).toEqual({
      type: "rom",
      width: testCase.width, height: testCase.height,
      cursor: testCase.cursor, values: testCase.values,
      wrapX: true, wrapY: true,
    });
    // The cursor follows its cell rather than selecting another value after a turn.
    expect(transformed.advanceRomAtIndex(0, 0, 0)).toBe(-1);
    expect(transformed.advanceRomAtIndex(0, 1, 0)).toBe(
      testCase.values[(testCase.cursor + 1) % testCase.values.length],
    );
    expect(world.componentStateSnapshotAt(0, 0)).toEqual({
      type: "rom", width: 2, height: 3, cursor: 2,
      wrapX: true, wrapY: true,
      values: [1, 0, -1, 1, 0, -1],
    });
  });

  it.each([
    {
      inputX: 0,
      inputY: 1,
      expectedCursors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0],
    },
    {
      inputX: 1,
      inputY: 2,
      expectedCursors: [15, 11, 7, 3, 14, 10, 6, 2, 13, 9, 5, 1, 12, 8, 4, 0],
    },
  ])(
    "carries input at ($inputX, $inputY) across both ROM dimensions",
    ({ inputX, inputY, expectedCursors }) => {
      const world = new World(3, 3);
      world.place(1, 0, TileKind.Conduit);
      world.place(0, 1, TileKind.Conduit);
      world.place(1, 1, TileKind.Rom, Direction.Up);
      world.place(2, 1, TileKind.Conduit);
      world.place(1, 2, TileKind.Conduit);
      world.setWeld(1, 0, 1, 1, true);
      world.setWeld(0, 1, 1, 1, true);
      world.setWeld(1, 1, 2, 1, true);
      world.setWeld(1, 1, 1, 2, true);
      world.configureTernaryGrid(1, 1, 4, 4, Array.from({ length: 16 }, () => 0));
      const simulation = new Simulation(world);

      for (const expectedCursor of expectedCursors) {
        world.setCharge(inputX, inputY, 1);
        simulation.step();
        expect(world.componentStateSnapshotAt(1, 1)).toMatchObject({
          type: "rom",
          cursor: expectedCursor,
        });
      }
    },
  );

  it.each([
    {
      orientation: Direction.Up,
      port: "left",
      inputX: 0,
      inputY: 1,
      positiveCursor: 5,
      negativeCursor: 3,
    },
    {
      orientation: Direction.Up,
      port: "rear",
      inputX: 1,
      inputY: 2,
      positiveCursor: 1,
      negativeCursor: 7,
    },
    {
      orientation: Direction.Right,
      port: "left",
      inputX: 1,
      inputY: 0,
      positiveCursor: 7,
      negativeCursor: 1,
    },
    {
      orientation: Direction.Right,
      port: "rear",
      inputX: 0,
      inputY: 1,
      positiveCursor: 5,
      negativeCursor: 3,
    },
    {
      orientation: Direction.Down,
      port: "left",
      inputX: 2,
      inputY: 1,
      positiveCursor: 3,
      negativeCursor: 5,
    },
    {
      orientation: Direction.Down,
      port: "rear",
      inputX: 1,
      inputY: 0,
      positiveCursor: 7,
      negativeCursor: 1,
    },
    {
      orientation: Direction.Left,
      port: "left",
      inputX: 1,
      inputY: 2,
      positiveCursor: 1,
      negativeCursor: 7,
    },
    {
      orientation: Direction.Left,
      port: "rear",
      inputX: 2,
      inputY: 1,
      positiveCursor: 3,
      negativeCursor: 5,
    },
  ])(
    "moves away from the $port input for ROM orientation $orientation",
    ({ orientation, inputX, inputY, positiveCursor, negativeCursor }) => {
      for (const [charge, expectedCursor] of [
        [1, positiveCursor],
        [-1, negativeCursor],
      ] as const) {
        const world = new World(3, 3);
        world.place(1, 0, TileKind.Conduit);
        world.place(0, 1, TileKind.Conduit);
        world.place(1, 1, TileKind.Rom, orientation);
        world.place(2, 1, TileKind.Conduit);
        world.place(1, 2, TileKind.Conduit);
        world.setWeld(1, 0, 1, 1, true);
        world.setWeld(0, 1, 1, 1, true);
        world.setWeld(1, 1, 2, 1, true);
        world.setWeld(1, 1, 1, 2, true);
        world.restoreComponentState(1, 1, {
          type: "rom",
          width: 3,
          height: 3,
          cursor: 4,
          wrapX: true, wrapY: true,
          values: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        });
        world.setCharge(inputX, inputY, charge);

        new Simulation(world).step();

        expect(world.componentStateSnapshotAt(1, 1)).toMatchObject({
          type: "rom",
          cursor: expectedCursor,
        });
      }
    },
  );

  it("keeps horizontal and vertical wire-crossing networks independent", () => {
    const world = new World(4, 5);
    world.place(0, 3, TileKind.Platform);
    world.place(1, 3, TileKind.Sensor, Direction.Left);
    world.place(2, 3, TileKind.WireCrossing);
    world.place(3, 3, TileKind.Conduit);
    world.place(2, 0, TileKind.Platform);
    world.place(2, 1, TileKind.Sensor, Direction.Up);
    world.place(2, 2, TileKind.Inverter, Direction.Down);
    world.place(2, 4, TileKind.Conduit);
    world.setWeld(1, 3, 2, 3, true);
    world.setWeld(2, 3, 3, 3, true);
    world.setWeld(2, 1, 2, 2, true);
    world.setWeld(2, 2, 2, 3, true);
    world.setWeld(2, 3, 2, 4, true);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();

    expect(world.chargeAtPort(2, 3, Direction.Left)).toBe(1);
    expect(world.chargeAtPort(2, 3, Direction.Right)).toBe(1);
    expect(world.chargeAtPort(2, 3, Direction.Up)).toBe(-1);
    expect(world.chargeAtPort(2, 3, Direction.Down)).toBe(-1);
    expect(world.chargeAt(3, 3)).toBe(1);
    expect(world.chargeAt(2, 4)).toBe(-1);
  });

  it("restores both wire-crossing axis charges from a snapshot", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.WireCrossing);
    world.setCrossingCharges(0, 0, 1, -1);
    const snapshot = world.clone();
    const simulation = new Simulation(world);
    world.setCrossingCharges(0, 0, 0, 0);

    simulation.resetTo(snapshot);

    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(1);
    expect(world.chargeAtPort(0, 0, Direction.Up)).toBe(-1);
  });

});
