import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { SwapperResolver } from "../src/simulation/swapper-resolver";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function swap(world: World, x: number, y: number): number {
  const resolver = new SwapperResolver(world);
  resolver.collect(y * world.width + x);
  return resolver.commit();
}

function circuitWorld(): World {
  const world = new World(5, 5);
  world.place(2, 2, TileKind.Swapper, Direction.Up);
  world.place(2, 1, TileKind.Floatstone);
  world.place(2, 3, TileKind.Floatstone);
  world.setWeld(2, 1, 2, 2, true);
  world.setWeld(2, 2, 2, 3, true);
  world.place(1, 2, TileKind.Conduit);
  world.place(3, 2, TileKind.Conduit);
  world.setWeld(1, 2, 2, 2, true);
  world.setWeld(2, 2, 3, 2, true);
  return world;
}

describe("swapper cell exchange", () => {
  it("moves identity, configured state, charge and handedness, but leaves welds and other body cells at their sites", () => {
    const world = new World(5, 5);
    world.place(2, 2, TileKind.Swapper, Direction.Right);
    const stone = world.place(3, 2, TileKind.Stone);
    const rune = world.place(1, 2, TileKind.Rom, Direction.Left, true);
    world.configureTernaryGrid(1, 2, 2, 2, [1, 0, -1, 1], { wrapX: false });
    world.advanceRomAtIndex(11, 1, 0);
    world.setCharge(1, 2, -1);
    const state = world.componentStateSnapshotAt(1, 2);
    const upper = world.place(3, 1, TileKind.Stone);
    const lower = world.place(3, 3, TileKind.Stone);
    world.setWeld(3, 1, 3, 2, true);
    world.setWeld(3, 2, 3, 3, true);

    swap(world, 2, 2);

    expect(world.idAt(3, 2)).toBe(rune);
    expect(world.idAt(1, 2)).toBe(stone);
    expect(world.orientationAt(3, 2)).toBe(Direction.Left);
    expect(world.mirroredAt(3, 2)).toBe(true);
    expect(world.componentStateSnapshotAt(3, 2)).toEqual(state);
    expect(world.chargeAt(3, 2)).toBe(-1);
    expect(world.chargeAt(1, 2)).toBe(0);
    expect(world.idAt(3, 1)).toBe(upper);
    expect(world.idAt(3, 3)).toBe(lower);
    expect(world.isWelded(3, 1, 3, 2)).toBe(true);
    expect(world.isWelded(3, 2, 3, 3)).toBe(true);
    expect(world.isWelded(1, 2, 2, 2)).toBe(false);
  });

  it.each([TileKind.Empty, TileKind.Sand])("removes site welds made illegal by incoming kind %s without moving the neighbors", (incoming) => {
    const world = new World(5, 3);
    world.place(2, 1, TileKind.Swapper, Direction.Right);
    const stone = world.place(3, 1, TileKind.Stone);
    const neighbor = world.place(4, 1, TileKind.Stone);
    world.place(1, 1, incoming);
    world.setWeld(2, 1, 3, 1, true);
    world.setWeld(3, 1, 4, 1, true);

    swap(world, 2, 1);

    expect(world.idAt(1, 1)).toBe(stone);
    expect(world.kindAt(3, 1)).toBe(incoming);
    expect(world.idAt(4, 1)).toBe(neighbor);
    expect(world.isWelded(2, 1, 3, 1)).toBe(false);
    expect(world.isWelded(3, 1, 4, 1)).toBe(false);
    expect(world.isWelded(1, 1, 2, 1)).toBe(false);
  });

  it("uses the incoming rotator's current head, not its original facing, to retain site welds", () => {
    const world = new World(5, 5);
    world.place(2, 2, TileKind.Swapper, Direction.Right);
    const rotator = world.place(1, 2, TileKind.Rotator, Direction.Up, true);
    world.setRotatorDirectionAtIndex(11, Direction.Right);
    world.place(3, 2, TileKind.Stone);
    for (const [x, y] of [[3, 1], [4, 2], [3, 3]] as const) {
      world.place(x, y, TileKind.Stone);
      world.setWeld(3, 2, x, y, true);
    }
    world.setWeld(2, 2, 3, 2, true);

    swap(world, 2, 2);

    expect(world.idAt(3, 2)).toBe(rotator);
    expect(world.rotatorDirectionAtIndex(13)).toBe(Direction.Right);
    expect(world.orientationAt(3, 2)).toBe(Direction.Up);
    expect(world.mirroredAt(3, 2)).toBe(true);
    expect(world.isWelded(3, 2, 4, 2)).toBe(true);
    expect(world.isWelded(3, 2, 3, 3)).toBe(true);
    expect(world.isWelded(3, 1, 3, 2)).toBe(false);
    expect(world.isWelded(2, 2, 3, 2)).toBe(false);
  });

  it.each([TileKind.Platform, TileKind.IndestructibleConduit, TileKind.Delivery])(
    "blocks protected or fixed target %s without changing either endpoint or its protected seam",
    (kind) => {
      const world = new World(5, 3);
      world.place(2, 1, TileKind.Swapper, Direction.Right);
      const front = world.place(3, 1, kind);
      const rear = world.place(1, 1, TileKind.Stone);
      world.place(4, 1, TileKind.Platform);
      world.setWeld(3, 1, 4, 1, true);

      expect(swap(world, 2, 1)).toBe(0);
      expect(world.idAt(3, 1)).toBe(front);
      expect(world.idAt(1, 1)).toBe(rear);
      expect(world.isWelded(3, 1, 4, 1)).toBe(true);
    },
  );

  it("rejects an out-of-bounds rear rather than wrapping to the previous row", () => {
    const world = new World(3, 3);
    world.place(0, 1, TileKind.Swapper, Direction.Right);
    const front = world.place(1, 1, TileKind.Stone);
    const previousRow = world.place(2, 0, TileKind.Wood);

    expect(swap(world, 0, 1)).toBe(0);
    expect(world.idAt(1, 1)).toBe(front);
    expect(world.idAt(2, 0)).toBe(previousRow);
  });

  it.each([1, 2, 3])("cancels an observed swap when source cell %s is replaced with the same kind", (x) => {
    const world = new World(5, 1);
    world.place(1, 0, TileKind.Stone);
    world.place(2, 0, TileKind.Swapper, Direction.Right);
    world.place(3, 0, TileKind.Wood);
    const resolver = new SwapperResolver(world);
    resolver.collect(2);
    const kind = world.kindAt(x, 0);
    world.place(x, 0, TileKind.Empty);
    world.place(x, 0, kind, Direction.Right);
    const ids = [world.idAt(1, 0), world.idAt(2, 0), world.idAt(3, 0)];

    expect(resolver.commit()).toBe(0);
    expect([world.idAt(1, 0), world.idAt(2, 0), world.idAt(3, 0)]).toEqual(ids);
  });

  it("does not exchange a newly occupied endpoint that was empty when observed", () => {
    const world = new World(5, 1);
    world.place(2, 0, TileKind.Swapper, Direction.Right);
    const front = world.place(3, 0, TileKind.Stone);
    const resolver = new SwapperResolver(world);
    resolver.collect(2);
    const replacement = world.place(1, 0, TileKind.Wood);

    expect(resolver.commit()).toBe(0);
    expect(world.idAt(1, 0)).toBe(replacement);
    expect(world.idAt(3, 0)).toBe(front);
  });

  it.each([false, true])("jams every claimant of a shared endpoint regardless of placement/collection order (reverse=%s)", (reverse) => {
    const world = new World(7, 1);
    const actuators = reverse ? [4, 2] : [2, 4];
    for (const x of actuators) world.place(x, 0, TileKind.Swapper, Direction.Right);
    const ids = [1, 3, 5].map((x) => world.place(x, 0, TileKind.Stone));
    const resolver = new SwapperResolver(world);
    for (const x of actuators) resolver.collect(x);

    expect(resolver.commit()).toBe(0);
    expect([1, 3, 5].map((x) => world.idAt(x, 0))).toEqual(ids);
  });

  it.each([false, true])("jams swaps that would move each other's actuators (reverse=%s)", (reverse) => {
    const world = new World(6, 1);
    const actuators = reverse ? [3, 2] : [2, 3];
    for (const x of actuators) world.place(x, 0, TileKind.Swapper, Direction.Right);
    world.place(1, 0, TileKind.Stone);
    world.place(4, 0, TileKind.Wood);
    const ids = [1, 2, 3, 4].map((x) => world.idAt(x, 0));
    const resolver = new SwapperResolver(world);
    for (const x of actuators) resolver.collect(x);

    expect(resolver.commit()).toBe(0);
    expect([1, 2, 3, 4].map((x) => world.idAt(x, 0))).toEqual(ids);
  });

  it.each([false, true])("commits disjoint swaps beside one shared weld, removing it if either final endpoint is unweldable (reverse=%s)", (reverse) => {
    const world = new World(5, 4);
    const rows = reverse ? [2, 1] : [1, 2];
    for (const y of rows) world.place(2, y, TileKind.Swapper, Direction.Right);
    world.place(1, 1, TileKind.Stone);
    world.place(1, 2, TileKind.Wood);
    const sand = world.place(3, 1, TileKind.Sand);
    const metal = world.place(3, 2, TileKind.Iron);
    world.setWeld(1, 1, 1, 2, true);
    const resolver = new SwapperResolver(world);
    for (const y of rows) resolver.collect(y * world.width + 2);

    resolver.commit();
    expect(world.idAt(1, 1)).toBe(sand);
    expect(world.idAt(1, 2)).toBe(metal);
    expect(world.isWelded(1, 1, 1, 2)).toBe(false);
    expect(world.isWelded(3, 1, 3, 2)).toBe(false);
  });

  it("carries a live nested board without resetting its configuration or state", () => {
    const world = new World(5, 1);
    world.place(2, 0, TileKind.Swapper, Direction.Right);
    const array = world.place(1, 0, TileKind.RuneArray);
    world.configureRuneArray(1, 0, 3, 1, "carried board");
    const inner = world.runeArrayWorldAt(1, 0);
    inner.place(1, 0, TileKind.Counter, Direction.Left);
    inner.configureNumericComponent(1, 0, 5);
    inner.advanceCounterAtIndex(1, 1);
    const state = inner.componentStateSnapshotAt(1, 0);

    swap(world, 2, 0);
    expect(world.idAt(3, 0)).toBe(array);
    expect(world.runeArrayWorldAt(3, 0).componentStateSnapshotAt(1, 0)).toEqual(state);
    const imported = deserializeBoard(serializeBoard(world, 0)).world;
    expect(imported.componentStateSnapshotAt(3, 0)).toMatchObject({ description: "carried board" });
    expect(imported.runeArrayWorldAt(3, 0).componentStateSnapshotAt(1, 0)).toEqual(state);
  });
});

describe("swapper circuit activation", () => {
  it.each([1, 3])("accepts previous-tick +1 on side x=%s despite -1 on the opposite input", (positiveX) => {
    const world = circuitWorld();
    const front = world.idAt(2, 1);
    const rear = world.idAt(2, 3);
    world.setCharge(positiveX, 2, 1);
    world.setCharge(4 - positiveX, 2, -1);

    new Simulation(world).step();

    expect(world.idAt(2, 1)).toBe(rear);
    expect(world.idAt(2, 3)).toBe(front);
  });

  it("waits one tick, repeats held input, does not leak to the opposite network, and stops on disconnection", () => {
    const world = circuitWorld();
    world.place(1, 2, TileKind.FixedCharge);
    world.setWeld(1, 2, 2, 2, true);
    const front = world.idAt(2, 1);
    const rear = world.idAt(2, 3);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(2, 1)).toBe(front);
    expect(world.chargeAt(1, 2)).toBe(1);
    expect(world.chargeAt(3, 2)).toBe(0);
    simulation.step();
    expect(world.idAt(2, 1)).toBe(rear);
    expect(world.chargeAt(3, 2)).toBe(0);
    simulation.step();
    expect(world.idAt(2, 1)).toBe(front);

    world.setWeld(1, 2, 2, 2, false);
    simulation.step();
    expect(world.idAt(2, 1)).toBe(front);
    expect(world.idAt(2, 3)).toBe(rear);
  });

  it("ignores neutral and negative inputs, including a disconnected positive neighbor", () => {
    const world = circuitWorld();
    const front = world.idAt(2, 1);
    const rear = world.idAt(2, 3);
    const simulation = new Simulation(world);
    world.setCharge(1, 2, -1);
    simulation.step();
    expect(world.idAt(2, 1)).toBe(front);
    world.setCharge(1, 2, 1);
    world.setWeld(1, 2, 2, 2, false);
    simulation.step();
    expect(world.idAt(2, 1)).toBe(front);
    expect(world.idAt(2, 3)).toBe(rear);
  });

  it("reads a virtual side port inside an array and preserves its pending activation through save/load", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.RuneArray);
    world.configureRuneArray(1, 0, 3, 3, "swapping room");
    world.setWeld(0, 0, 1, 0, true);
    const inner = world.runeArrayWorldAt(1, 0);
    inner.place(0, 1, TileKind.Swapper, Direction.Up);
    inner.place(0, 0, TileKind.Floatstone);
    inner.place(0, 2, TileKind.Wood);
    inner.setWeld(0, 0, 0, 1, true);
    inner.setWeld(0, 1, 0, 2, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(inner.kindAt(0, 0)).toBe(TileKind.Floatstone);
    const imported = deserializeBoard(serializeBoard(world, simulation.tick));
    const restoredInner = imported.world.runeArrayWorldAt(1, 0);
    new Simulation(imported.world).step();
    simulation.step();

    for (const board of [inner, restoredInner]) {
      expect(board.kindAt(0, 0)).toBe(TileKind.Wood);
      expect(board.kindAt(0, 2)).toBe(TileKind.Floatstone);
      expect(board.isWelded(0, 0, 0, 1)).toBe(true);
      expect(board.isWelded(0, 1, 0, 2)).toBe(true);
    }
  });
});
