import { describe, expect, it } from "vitest";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import type { Charge } from "../src/simulation/circuit";
import { Simulation } from "../src/simulation/simulation";
import { Direction, directionX, directionY, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";
import { expectDefined } from "../src/util/assert";

const values = [-1, 1, 0, 0, -1, 1, 1, 0, -1] as const;

function port(orientation: Direction, side: Direction, mirrored = false): readonly [number, number] {
  const direction = ((orientation + (mirrored ? (4 - side) & 3 : side)) & 3) as Direction;
  return [1 + directionX(direction), 1 + directionY(direction)];
}

function placeLookup(world: World, orientation = Direction.Up, mirrored = false): void {
  world.place(1, 1, TileKind.Lut, orientation, mirrored);
  for (const side of [Direction.Up, Direction.Right, Direction.Down, Direction.Left]) {
    const [x, y] = port(orientation, side, mirrored);
    world.place(x, y, TileKind.Conduit);
    world.setWeld(1, 1, x, y, true);
  }
  world.configureTernaryGrid(1, 1, 3, 3, values);
}

function feed(world: World, simulation: Simulation, left: Charge, rear: Charge): readonly Charge[] {
  const orientation = world.orientationAt(1, 1);
  const mirrored = world.mirroredAt(1, 1);
  const [leftX, leftY] = port(orientation, Direction.Left, mirrored);
  const [rearX, rearY] = port(orientation, Direction.Down, mirrored);
  world.setCharge(leftX, leftY, left);
  world.setCharge(rearX, rearY, rear);
  simulation.step();
  return [Direction.Up, Direction.Right].map((side) => {
    const [x, y] = port(orientation, side, mirrored);
    return world.chargeAt(x, y);
  });
}

describe("lookup rune", () => {
  it.each(
    [Direction.Up, Direction.Right, Direction.Down, Direction.Left].flatMap((orientation) =>
      [false, true].map((mirrored) => ({ orientation, mirrored })),
    ),
  )(
    "addresses all nine logical cells at orientation $orientation, mirrored $mirrored",
    ({ orientation, mirrored }) => {
      const world = new World(3, 3);
      placeLookup(world, orientation, mirrored);
      const simulation = new Simulation(world);
      const observed: Charge[] = [];
      for (const rear of [-1, 0, 1] as const) {
        for (const left of [-1, 0, 1] as const) {
          const output = feed(world, simulation, left, rear);
          expect(output[0]).toBe(output[1]);
          observed.push(expectDefined(output[0], "Lookup front output"));
          expect(feed(world, simulation, left, rear)).toEqual(output);
        }
      }
      expect(observed).toEqual(values);
      const [x, y] = port(orientation, Direction.Left, mirrored);
      const inputSide = ((orientation + (mirrored ? Direction.Right : Direction.Left)) & 3) as Direction;
      expect(world.chargeAtPort(1, 1, inputSide)).toBe(0);
      expect(world.chargeAt(x, y)).toBe(0);
    },
  );

  it("treats disconnected inputs as neutral and observes old source charges", () => {
    const world = new World(3, 3);
    placeLookup(world);
    world.setWeld(1, 1, 0, 1, false);
    world.setWeld(1, 1, 1, 2, false);
    world.setCharge(0, 1, 1);
    world.setCharge(1, 2, -1);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(-1);
    world.place(0, 1, TileKind.FixedCharge);
    world.setWeld(1, 1, 0, 1, true);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(-1);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(1);
  });

  it("keeps logical addresses through rotation, reflection, cloning and nested scene persistence", () => {
    const root = new World(1, 1);
    root.place(0, 0, TileKind.RuneArray);
    root.configureRuneArray(0, 0, 3, 3, "");
    placeLookup(root.runeArrayWorldAt(0, 0));
    for (const restored of [root.clone(), deserializeBoard(serializeBoard(root, 0)).world]) {
      const inner = restored.runeArrayWorldAt(0, 0);
      expect(feed(inner, new Simulation(restored), -1, 1)).toEqual([1, 1]);
      const rotated = inner.transformed(1, false, false);
      expect(feed(rotated, new Simulation(rotated), -1, 1)).toEqual([1, 1]);
      const reflected = rotated.transformed(0, true, false);
      expect(feed(reflected, new Simulation(reflected), -1, 1)).toEqual([1, 1]);
      inner.configureTernaryGrid(1, 1, 3, 3, new Array<Charge>(9).fill(0));
    }
    const original = root.runeArrayWorldAt(0, 0);
    expect(feed(original, new Simulation(root), -1, 1)).toEqual([1, 1]);
  });

  it("rejects non-3x3 or non-ternary tables without altering the configured function", () => {
    const world = new World(3, 3);
    placeLookup(world);
    expect(() => world.configureTernaryGrid(1, 1, 1, 9, values)).toThrow(RangeError);
    expect(() => world.configureTernaryGrid(1, 1, 3, 3, [1])).toThrow(RangeError);
    const board = JSON.parse(serializeBoard(world, 0));
    for (const invalid of [
      { width: 1, height: 9, values },
      { width: 3, height: 3, values: [1] },
      { width: 3, height: 3, values: [2, ...values.slice(1)] },
    ]) {
      expect(() => deserializeBoard(JSON.stringify({
        ...board, components: [{ x: 1, y: 1, type: "lut", ...invalid }],
      }))).toThrow();
    }
    expect(feed(world, new Simulation(world), -1, 1)).toEqual([1, 1]);
  });
});
