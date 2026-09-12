import { describe, expect, it } from "vitest";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import type { Charge } from "../src/simulation/circuit";
import { Simulation } from "../src/simulation/simulation";
import { Direction, directionX, directionY, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function placeDiscard(world: World, direction: Direction, length: number): void {
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      world.place(x, y, TileKind.Platform);
    }
  }
  const dx = directionX(direction);
  const dy = directionY(direction);
  world.place(1, 1, TileKind.Discard, direction);
  world.place(1 - dx, 1 - dy, TileKind.Conduit);
  world.place(1 + dx, 1 + dy, TileKind.Conduit);
  world.setWeld(1, 1, 1 - dx, 1 - dy, true);
  world.setWeld(1, 1, 1 + dx, 1 + dy, true);
  world.configureNumericComponent(1, 1, length);
}

function feed(world: World, simulation: Simulation, direction: Direction, input: Charge): Charge {
  const dx = directionX(direction);
  const dy = directionY(direction);
  world.setCharge(1 - dx, 1 - dy, input);
  simulation.step();
  return world.chargeAt(1 + dx, 1 + dy);
}

describe("discard rune", () => {
  it.each([Direction.Up, Direction.Right, Direction.Down, Direction.Left])(
    "suppresses exactly N ticks including zeros, then passes signed inputs in orientation %s",
    (direction) => {
      const world = new World(3, 3);
      placeDiscard(world, direction, 3);
      const simulation = new Simulation(world);
      const inputs: readonly Charge[] = [1, 0, -1, -1, 0, 1, 1];
      const outputs = inputs.map((input) => feed(world, simulation, direction, input));
      expect(outputs).toEqual([0, 0, 0, -1, 0, 1, 1]);
      expect(world.chargeAt(1 - directionX(direction), 1 - directionY(direction))).toBe(0);
    },
  );

  it("passes immediately with N=0 and rearms only when its configuration changes", () => {
    const world = new World(3, 3);
    placeDiscard(world, Direction.Right, 0);
    const simulation = new Simulation(world);
    expect(feed(world, simulation, Direction.Right, -1)).toBe(-1);
    world.configureNumericComponent(1, 1, 1);
    expect(world.chargeAt(1, 1)).toBe(0);
    expect(feed(world, simulation, Direction.Right, 1)).toBe(0);
    expect(world.configureNumericComponent(1, 1, 1)).toBe(false);
    expect(feed(world, simulation, Direction.Right, -1)).toBe(-1);
    world.configureNumericComponent(1, 1, 2);
    expect(feed(world, simulation, Direction.Right, 1)).toBe(0);
    expect(feed(world, simulation, Direction.Right, 1)).toBe(0);
    expect(feed(world, simulation, Direction.Right, 1)).toBe(1);
  });

  it("continues the remaining discard window after cloning and nested scene round trips", () => {
    const root = new World(1, 1);
    root.place(0, 0, TileKind.RuneArray);
    root.configureRuneArray(0, 0, 3, 3, "");
    const inner = root.runeArrayWorldAt(0, 0);
    placeDiscard(inner, Direction.Right, 3);
    const simulation = new Simulation(root);
    feed(inner, simulation, Direction.Right, 1);
    feed(inner, simulation, Direction.Right, 0);

    for (const restored of [root.clone(), deserializeBoard(serializeBoard(root, 2)).world]) {
      const restoredInner = restored.runeArrayWorldAt(0, 0);
      const resumed = new Simulation(restored);
      expect(feed(restoredInner, resumed, Direction.Right, -1)).toBe(0);
      expect(feed(restoredInner, resumed, Direction.Right, -1)).toBe(-1);
      expect(feed(restoredInner, resumed, Direction.Right, 1)).toBe(1);
    }
    expect(feed(inner, simulation, Direction.Right, 1)).toBe(0);
  });

  it("rejects invalid saved discard windows, progress, and tile/state mismatches", () => {
    const world = new World(3, 3);
    placeDiscard(world, Direction.Right, 3);
    const board = JSON.parse(serializeBoard(world, 0)) as {
      components: { type: string; length: number; discarded: number }[];
    };
    for (const state of [
      { type: "discard", length: -1, discarded: 0 },
      { type: "discard", length: 100, discarded: 0 },
      { type: "discard", length: 1.5, discarded: 0 },
      { type: "discard", length: 3, discarded: -1 },
      { type: "discard", length: 3, discarded: 4 },
      { type: "discard", length: 3, discarded: 0.5 },
      { type: "counter", threshold: 3, count: 0 },
    ]) {
      expect(() => deserializeBoard(JSON.stringify({
        ...board,
        components: [{ x: 1, y: 1, ...state }],
      }))).toThrow();
    }
  });
});
