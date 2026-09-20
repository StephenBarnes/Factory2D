import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function row(world: World, y = 0): TileKind[] {
  return Array.from({ length: world.width }, (_, x) => world.kindAt(x, y));
}

describe("fire", () => {
  it("spreads only one cell per tick, including converging flames", () => {
    const world = new World(5, 1);
    for (let x = 0; x < 5; x += 1) world.place(x, 0, TileKind.Wood);
    world.place(0, 0, TileKind.Fire);
    world.place(4, 0, TileKind.Fire);
    const simulation = new Simulation(world);
    simulation.step();
    expect(row(world)).toEqual([TileKind.Empty, TileKind.Fire, TileKind.Wood, TileKind.Fire, TileKind.Empty]);
    simulation.step();
    expect(row(world)).toEqual([TileKind.Empty, TileKind.Empty, TileKind.Fire, TileKind.Empty, TileKind.Empty]);
    simulation.step();
    expect(row(world)).toEqual(Array(5).fill(TileKind.Empty));
  });

  it("ignites all four orthogonal neighbors but not diagonal wood or other materials", () => {
    const world = new World(3, 3);
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) world.place(x, y, TileKind.Wood);
    }
    // Anchor the corners so gravity cannot obscure which cells ignite.
    world.place(0, 2, TileKind.Platform);
    world.place(2, 2, TileKind.Platform);
    world.setWeld(0, 0, 0, 1, true);
    world.setWeld(0, 1, 0, 2, true);
    world.setWeld(2, 0, 2, 1, true);
    world.setWeld(2, 1, 2, 2, true);
    world.place(1, 1, TileKind.Fire);
    new Simulation(world).step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Fire);
    expect(world.kindAt(0, 1)).toBe(TileKind.Fire);
    expect(world.kindAt(2, 1)).toBe(TileKind.Fire);
    expect(world.kindAt(1, 2)).toBe(TileKind.Fire);
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(0, 0)).toBe(TileKind.Wood);
    expect(world.kindAt(2, 0)).toBe(TileKind.Wood);
    expect(world.kindAt(0, 2)).toBe(TileKind.Platform);
  });

  it("does not wrap across row boundaries", () => {
    const world = new World(3, 2);
    world.place(2, 0, TileKind.Fire);
    world.place(0, 1, TileKind.Wood);
    new Simulation(world).step();
    expect(world.kindAt(2, 0)).toBe(TileKind.Empty);
    expect(world.kindAt(0, 1)).toBe(TileKind.Wood);
  });

  it("removes burning wood's welds and releases the surviving structure before gravity", () => {
    const world = new World(3, 3);
    world.place(0, 0, TileKind.Platform);
    world.place(1, 0, TileKind.Wood);
    world.place(2, 0, TileKind.Stone);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 2, 0, true);
    world.place(1, 1, TileKind.Fire);
    expect(world.setWeld(1, 0, 1, 1, true)).toBe(false);
    new Simulation(world).step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Fire);
    expect(world.isWelded(0, 0, 1, 0)).toBe(false);
    expect(world.isWelded(1, 0, 2, 0)).toBe(false);
    expect(world.kindAt(2, 0)).toBe(TileKind.Empty);
    expect(world.kindAt(2, 1)).toBe(TileKind.Stone);
  });

  it("does not ignite newly duplicated wood that was absent at the start of the tick", () => {
    const world = new World(4, 1);
    world.place(0, 0, TileKind.Wood);
    world.place(1, 0, TileKind.Duplicator, Direction.Right);
    world.setCharge(1, 0, 1);
    world.place(3, 0, TileKind.Fire);
    new Simulation(world).step();
    expect(world.kindAt(2, 0)).toBe(TileKind.Wood);
    expect(world.kindAt(3, 0)).toBe(TileKind.Empty);
  });

  it("resumes nested fire after save/load and resets without retaining stale intents", () => {
    const original = new World(1, 1);
    original.place(0, 0, TileKind.RuneArray);
    original.configureRuneArray(0, 0, 3, 1, "");
    const inner = original.runeArrayWorldAt(0, 0);
    inner.place(0, 0, TileKind.Fire);
    inner.place(1, 0, TileKind.Wood);
    inner.place(2, 0, TileKind.Wood);
    const world = deserializeBoard(serializeBoard(original, 0)).world;
    const baseline = world.clone();
    const simulation = new Simulation(world);
    simulation.step();
    expect(row(world.runeArrayWorldAt(0, 0))).toEqual([TileKind.Empty, TileKind.Fire, TileKind.Wood]);
    simulation.resetTo(baseline);
    simulation.step();
    expect(row(world.runeArrayWorldAt(0, 0))).toEqual([TileKind.Empty, TileKind.Fire, TileKind.Wood]);
    simulation.step();
    expect(row(world.runeArrayWorldAt(0, 0))).toEqual([TileKind.Empty, TileKind.Empty, TileKind.Fire]);
  });
});
