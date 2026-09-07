import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function matchingBodies(): World {
  const world = new World(7, 3);
  for (let x = 0; x < world.width; x += 1) world.place(x, 2, TileKind.Platform);
  world.place(3, 1, TileKind.Comparer, Direction.Right);
  for (const x of [1, 4]) {
    world.place(x, 1, TileKind.Stone);
    world.place(x + 1, 1, TileKind.Iron);
    world.setWeld(x, 1, x + 1, 1, true);
  }
  world.place(3, 0, TileKind.Conduit);
  world.setWeld(3, 0, 3, 1, true);
  return world;
}

describe("body comparer", () => {
  it("continuously compares complete translated bodies without consuming them, then clears on a weld change", () => {
    const world = matchingBodies();
    const simulation = new Simulation(world);
    const ids = [1, 2, 4, 5].map((x) => world.idAt(x, 1));
    simulation.step();
    simulation.step();
    expect(world.chargeAt(3, 0)).toBe(1);
    expect([1, 2, 4, 5].map((x) => world.idAt(x, 1))).toEqual(ids);
    world.setWeld(4, 1, 5, 1, false);
    simulation.step();
    expect(world.chargeAt(3, 0)).toBe(0);
  });

  it("rejects a body welded to itself and missing neighbors", () => {
    const world = matchingBodies();
    world.setWeld(2, 1, 3, 1, true);
    new Simulation(world).step();
    expect(world.chargeAt(3, 0)).toBe(0);
    const empty = new World(1, 1);
    empty.place(0, 0, TileKind.Comparer);
    new Simulation(empty).step();
    expect(empty.chargeAt(0, 0)).toBe(0);
  });

  it("ignores configuration but rejects directional orientation differences", () => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.Rom);
    world.configureTernaryGrid(0, 0, 1, 1, [1]);
    world.place(1, 0, TileKind.Comparer, Direction.Right);
    world.place(2, 0, TileKind.Rom);
    world.configureTernaryGrid(2, 0, 1, 1, [-1]);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(1);
    world.place(2, 0, TileKind.Rom, Direction.Left);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);
  });

  it("compares inside a serialized nested rune array", () => {
    const root = new World(1, 1);
    root.place(0, 0, TileKind.RuneArray);
    root.configureRuneArray(0, 0, 3, 1, "");
    const inner = root.runeArrayWorldAt(0, 0);
    inner.place(0, 0, TileKind.Stone);
    inner.place(1, 0, TileKind.Comparer, Direction.Left);
    inner.place(2, 0, TileKind.Stone);
    const restored = deserializeBoard(serializeBoard(root, 0)).world;
    new Simulation(restored).step();
    expect(restored.runeArrayWorldAt(0, 0).chargeAt(1, 0)).toBe(1);
    expect(restored.runeArrayWorldAt(0, 0).kindAt(2, 0)).toBe(TileKind.Stone);
  });
});
