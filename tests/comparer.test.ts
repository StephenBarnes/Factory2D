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

  it("distinguishes chiral bodies while block comparison ignores handedness", () => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.Selector);
    world.place(1, 0, TileKind.Comparer, Direction.Right);
    world.place(2, 0, TileKind.Selector, Direction.Up, true);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);
    world.place(0, 0, TileKind.Selector, Direction.Up, true);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(1);
    world.place(1, 0, TileKind.BlockComparer, Direction.Right);
    world.place(0, 0, TileKind.Selector);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(1);
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

describe("block type comparer", () => {
  it("ignores orientation, configuration, and attached bodies, and clears on a type change", () => {
    const world = new World(5, 2);
    world.place(1, 1, TileKind.Rom, Direction.Up);
    world.configureTernaryGrid(1, 1, 1, 1, [1]);
    world.place(2, 1, TileKind.BlockComparer, Direction.Right);
    world.place(3, 1, TileKind.Rom, Direction.Left);
    world.configureTernaryGrid(3, 1, 1, 1, [-1]);
    world.place(4, 1, TileKind.Stone);
    world.setWeld(3, 1, 4, 1, true);
    world.setWeld(1, 1, 2, 1, true);
    world.place(2, 0, TileKind.Conduit);
    world.setWeld(2, 0, 2, 1, true);
    const ids = [1, 3, 4].map((x) => world.idAt(x, 1));
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    expect(world.chargeAt(2, 0)).toBe(1);
    expect([1, 3, 4].map((x) => world.idAt(x, 1))).toEqual(ids);
    world.place(3, 1, TileKind.Stone);
    simulation.step();
    expect(world.chargeAt(2, 0)).toBe(0);
  });

  it("does not match empty cells or board edges", () => {
    const world = new World(3, 1);
    world.place(1, 0, TileKind.BlockComparer, Direction.Right);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);
    world.place(0, 0, TileKind.Stone);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);
    world.place(1, 0, TileKind.BlockComparer, Direction.Up);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);
  });

  it("compares vertically inside a serialized nested array and drives both side ports", () => {
    const root = new World(1, 1);
    root.place(0, 0, TileKind.RuneArray);
    root.configureRuneArray(0, 0, 3, 3, "");
    const inner = root.runeArrayWorldAt(0, 0);
    inner.place(1, 0, TileKind.Platform);
    inner.place(1, 1, TileKind.BlockComparer, Direction.Down);
    inner.place(1, 2, TileKind.Platform);
    for (const x of [0, 2]) {
      inner.place(x, 1, TileKind.Conduit);
      inner.setWeld(x, 1, 1, 1, true);
    }
    const restored = deserializeBoard(serializeBoard(root, 0)).world;
    new Simulation(restored).step();
    const restoredInner = restored.runeArrayWorldAt(0, 0);
    expect(restoredInner.chargeAt(0, 1)).toBe(1);
    expect(restoredInner.chargeAt(2, 1)).toBe(1);
    expect(restoredInner.kindAt(1, 0)).toBe(TileKind.Platform);
    expect(restoredInner.kindAt(1, 2)).toBe(TileKind.Platform);
  });
});

describe("beam block sensor", () => {
  it("looks through gaps and other types, detects glass, and clears when the match disappears", () => {
    const world = new World(7, 2);
    world.place(0, 1, TileKind.Glass);
    world.place(1, 1, TileKind.BeamBlockSensor, Direction.Right);
    world.setWeld(0, 1, 1, 1, true);
    world.place(2, 1, TileKind.Stone);
    world.place(4, 1, TileKind.Platform);
    world.place(6, 1, TileKind.Glass);
    world.place(1, 0, TileKind.Conduit);
    world.setWeld(1, 0, 1, 1, true);
    const targetId = world.idAt(6, 1);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(1);
    expect(world.idAt(6, 1)).toBe(targetId);
    world.place(6, 1, TileKind.Stone);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);
    world.place(0, 1, TileKind.Empty);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);
  });

  it.each([
    [Direction.Up, 0, -1],
    [Direction.Right, 1, 0],
    [Direction.Down, 0, 1],
    [Direction.Left, -1, 0],
  ] as const)("scans only its forward ray through the boundary in direction %s", (direction, dx, dy) => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.BeamBlockSensor, direction);
    world.place(3 - dx, 3 - dy, TileKind.Platform);
    world.setWeld(3, 3, 3 - dx, 3 - dy, true);
    world.place(3 + dx * 3, 3 + dy * 3, TileKind.Platform);
    // A match just off the ray must not count, including across a row boundary.
    world.place(3 - dy, 3 + dx, TileKind.Platform);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.chargeAt(3, 3)).toBe(1);
    world.place(3 + dx * 3, 3 + dy * 3, TileKind.Empty);
    simulation.step();
    expect(world.chargeAt(3, 3)).toBe(0);
  });

  it("drives nested side ports after serialization without scanning outside the array", () => {
    const root = new World(3, 3);
    root.place(1, 1, TileKind.RuneArray);
    root.place(1, 2, TileKind.Platform);
    root.place(0, 1, TileKind.Conduit);
    root.setWeld(0, 1, 1, 1, true);
    root.configureRuneArray(1, 1, 5, 5, "");
    const inner = root.runeArrayWorldAt(1, 1);
    inner.place(2, 1, TileKind.Platform);
    inner.place(2, 2, TileKind.BeamBlockSensor, Direction.Down);
    inner.setWeld(2, 1, 2, 2, true);
    inner.place(2, 4, TileKind.Platform);
    for (const x of [0, 1, 3, 4]) inner.place(x, 2, TileKind.Conduit);
    for (let x = 0; x < 4; x += 1) inner.setWeld(x, 2, x + 1, 2, true);
    const restored = deserializeBoard(serializeBoard(root, 0)).world;
    const restoredInner = restored.runeArrayWorldAt(1, 1);
    const simulation = new Simulation(restored);
    simulation.step();
    expect(restored.chargeAt(0, 1)).toBe(1);
    expect(restoredInner.chargeAt(4, 2)).toBe(1);
    restoredInner.place(2, 4, TileKind.Empty);
    simulation.step();
    expect(restored.chargeAt(0, 1)).toBe(0);
    expect(restoredInner.chargeAt(4, 2)).toBe(0);
  });
});

describe("beam body sensor", () => {
  it("matches whole off-axis bodies through obstructions, not just the intersected block", () => {
    const world = new World(8, 3);
    for (let x = 0; x < world.width; x += 1) world.place(x, 2, TileKind.Platform);
    world.place(2, 1, TileKind.BeamBodySensor, Direction.Right);
    world.place(2, 0, TileKind.Conduit);
    world.setWeld(2, 0, 2, 1, true);
    for (const x of [1, 6]) {
      world.place(x, 1, TileKind.Stone);
      world.place(x, 0, TileKind.Iron);
      world.setWeld(x, 0, x, 1, true);
    }
    world.place(3, 1, TileKind.Platform);
    world.place(4, 1, TileKind.Stone);
    const id = world.idAt(6, 1);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.chargeAt(2, 0)).toBe(1);
    expect(world.idAt(6, 1)).toBe(id);
    world.setWeld(6, 0, 6, 1, false);
    simulation.step();
    expect(world.chargeAt(2, 0)).toBe(0);
  });

  it("rejects its own body and a missing template", () => {
    const world = new World(5, 1);
    world.place(0, 0, TileKind.Stone);
    world.place(1, 0, TileKind.BeamBodySensor, Direction.Right);
    world.place(4, 0, TileKind.Stone);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(1);
    world.setWeld(0, 0, 1, 0, true);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);
    world.place(0, 0, TileKind.Empty);
    simulation.step();
    expect(world.chargeAt(1, 0)).toBe(0);
  });

  it("preserves nested sensing through serialization and stops at the array boundary", () => {
    const root = new World(3, 3);
    root.place(1, 1, TileKind.RuneArray);
    root.place(1, 2, TileKind.Platform);
    root.place(0, 1, TileKind.Conduit);
    root.setWeld(0, 1, 1, 1, true);
    root.configureRuneArray(1, 1, 5, 5, "");
    const inner = root.runeArrayWorldAt(1, 1);
    inner.place(2, 1, TileKind.Platform);
    inner.place(2, 2, TileKind.BeamBodySensor, Direction.Down);
    inner.place(2, 4, TileKind.Platform);
    for (const x of [0, 1, 3, 4]) inner.place(x, 2, TileKind.Conduit);
    inner.place(0, 2, TileKind.IndestructibleConduit);
    inner.place(0, 3, TileKind.Platform);
    inner.setWeld(0, 2, 0, 3, true);
    for (let x = 0; x < 4; x += 1) inner.setWeld(x, 2, x + 1, 2, true);
    const restored = deserializeBoard(serializeBoard(root, 0)).world;
    const restoredInner = restored.runeArrayWorldAt(1, 1);
    const simulation = new Simulation(restored);
    simulation.step();
    expect(restored.chargeAt(0, 1)).toBe(1);
    expect(restoredInner.chargeAt(4, 2)).toBe(1);
    restoredInner.place(2, 4, TileKind.Empty);
    simulation.step();
    expect(restored.chargeAt(0, 1)).toBe(0);
    expect(restoredInner.chargeAt(4, 2)).toBe(0);
  });
});
