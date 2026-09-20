import { describe, expect, it } from "vitest";

import { serializeBoard } from "../src/simulation/board-export";
import { FlipperResolver } from "../src/simulation/flipper-resolver";
import { watchMachineryActivity } from "../src/simulation/machinery-activity";
import { RotatorResolver } from "../src/simulation/rotator-resolver";
import { watchShatterAnimation } from "../src/simulation/shatter-animation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function flipperWorld(): World {
  const world = new World(9, 7);
  world.place(4, 4, TileKind.Flipper, Direction.Up);
  world.place(4, 3, TileKind.Stone);
  world.setWeld(4, 4, 4, 3, true);
  world.setCharge(4, 4, 1);
  return world;
}

function rotatorWorld(): World {
  const world = new World(9, 9);
  world.place(3, 3, TileKind.Rotator, Direction.Up);
  world.setCharge(3, 3, 1);
  return world;
}

describe("destroyer reflections", () => {
  it("cuts only the contacted cell of a welded obstacle and preserves both surviving bodies", () => {
    const world = flipperWorld();
    const cutter = world.place(3, 3, TileKind.Destroyer);
    world.setWeld(3, 3, 4, 3, true);
    world.place(5, 3, TileKind.Stone);
    const remainder = world.place(6, 3, TileKind.Counter);
    const end = world.place(7, 3, TileKind.Platform);
    world.setWeld(5, 3, 6, 3, true);
    world.setWeld(6, 3, 7, 3, true);
    world.restoreComponentState(6, 3, { type: "counter", threshold: 7, count: 3 });
    const state = world.componentStateSnapshotAt(6, 3);
    const effects = watchShatterAnimation(world);
    const activity = watchMachineryActivity(world);

    new FlipperResolver(world).resolve();

    expect(world.idAt(5, 3)).toBe(cutter);
    expect(world.kindAt(3, 3)).toBe(TileKind.Empty);
    expect(world.idAt(6, 3)).toBe(remainder);
    expect(world.idAt(7, 3)).toBe(end);
    expect(world.componentStateSnapshotAt(6, 3)).toEqual(state);
    expect(world.isWelded(4, 3, 5, 3)).toBe(true);
    expect(world.isWelded(5, 3, 6, 3)).toBe(false);
    expect(world.isWelded(6, 3, 7, 3)).toBe(true);
    expect(world.isWelded(4, 4, 4, 3)).toBe(true);
    expect(effects.get(3 * world.width + 5)?.kind).toBe(TileKind.Stone);
    expect(activity).toEqual([{ voice: "break", index: 3 * world.width + 5 }]);
  });

  it("loses a moving tile to a stationary destroyer without attaching the survivor to it", () => {
    const world = flipperWorld();
    world.place(3, 3, TileKind.Stone);
    world.setWeld(3, 3, 4, 3, true);
    const cutter = world.place(5, 3, TileKind.Destroyer);
    const effects = watchShatterAnimation(world);

    new FlipperResolver(world).resolve();

    expect(world.kindAt(3, 3)).toBe(TileKind.Empty);
    expect(world.idAt(5, 3)).toBe(cutter);
    expect(world.isWelded(4, 3, 5, 3)).toBe(false);
    expect(world.isWelded(4, 4, 4, 3)).toBe(true);
    expect(effects.get(3 * world.width + 5)?.kind).toBe(TileKind.Stone);
  });

  it("destroys both destroyers at a reflected overlap", () => {
    const world = flipperWorld();
    world.place(3, 3, TileKind.Destroyer);
    world.place(5, 3, TileKind.Destroyer);
    world.setWeld(3, 3, 4, 3, true);
    const activity = watchMachineryActivity(world);

    new FlipperResolver(world).resolve();

    expect(world.kindAt(3, 3)).toBe(TileKind.Empty);
    expect(world.kindAt(5, 3)).toBe(TileKind.Empty);
    expect(world.isWelded(4, 3, 5, 3)).toBe(false);
    expect(world.isWelded(4, 4, 4, 3)).toBe(true);
    expect(activity).toEqual([
      { voice: "break", index: 3 * world.width + 5 },
      { voice: "break", index: 3 * world.width + 5 },
    ]);
  });

  it.each([
    [TileKind.Destroyer, TileKind.IndestructibleConduit],
    [TileKind.IndestructibleConduit, TileKind.Destroyer],
    [TileKind.Destroyer, TileKind.Platform],
  ])("keeps immune overlap %s against %s solid", (source, target) => {
    const world = flipperWorld();
    world.place(3, 3, source);
    world.place(5, 3, target);
    world.setWeld(3, 3, 4, 3, true);
    const before = serializeBoard(world, 0);
    const activity = watchMachineryActivity(world);

    expect(new FlipperResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
    expect(activity).toEqual([]);
  });

  it("does not cut an otherwise reachable victim when another destination blocks the flip", () => {
    const world = flipperWorld();
    world.place(3, 3, TileKind.Destroyer);
    world.place(2, 3, TileKind.Stone);
    world.place(5, 3, TileKind.Stone);
    world.place(6, 3, TileKind.Platform);
    world.setWeld(2, 3, 3, 3, true);
    world.setWeld(3, 3, 4, 3, true);
    const before = serializeBoard(world, 0);
    const activity = watchMachineryActivity(world);

    expect(new FlipperResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
    expect(activity).toEqual([]);
  });

  it("jams rival flips that cut the same target without removing either head seam", () => {
    const world = new World(9, 7);
    for (const x of [3, 5]) {
      world.place(x, 4, TileKind.Flipper, Direction.Up);
      world.place(x, 3, TileKind.Stone);
      const sourceX = x === 3 ? 2 : 6;
      world.place(sourceX, 3, TileKind.Destroyer);
      world.setWeld(x, 4, x, 3, true);
      world.setWeld(x, 3, sourceX, 3, true);
      world.setCharge(x, 4, 1);
    }
    world.place(4, 3, TileKind.Stone);
    const before = serializeBoard(world, 0);
    const effects = watchShatterAnimation(world);

    expect(new FlipperResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
    expect(effects.size).toBe(0);
  });

  it("can destroy its own stationary actuator without restoring a weld to the lost identity", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Flipper, Direction.Up);
    const pivot = world.place(3, 2, TileKind.Stone);
    const cutter = world.place(3, 1, TileKind.Destroyer);
    world.setWeld(3, 3, 3, 2, true);
    world.setWeld(3, 2, 3, 1, true);
    world.setCharge(3, 3, -1);

    new FlipperResolver(world).resolve();

    expect(world.idAt(3, 3)).toBe(cutter);
    expect(world.idAt(3, 2)).toBe(pivot);
    expect(world.componentStateSnapshotAt(3, 3)).toBeNull();
    expect(world.isWelded(3, 3, 3, 2)).toBe(true);
    expect(new FlipperResolver(world).resolve()).toBe(0);
  });
});

describe("destroyer rotation sweeps", () => {
  it("cuts a swept-only cell without capturing its untouched welded remainder", () => {
    const world = rotatorWorld();
    const cutter = world.place(3, 2, TileKind.Destroyer);
    world.setWeld(3, 3, 3, 2, true);
    world.place(4, 2, TileKind.Stone);
    const remainder = world.place(5, 2, TileKind.Counter);
    const end = world.place(6, 2, TileKind.Platform);
    world.setWeld(4, 2, 5, 2, true);
    world.setWeld(5, 2, 6, 2, true);
    world.restoreComponentState(5, 2, { type: "counter", threshold: 7, count: 3 });
    const state = world.componentStateSnapshotAt(5, 2);
    const effects = watchShatterAnimation(world);

    new RotatorResolver(world).resolve();

    expect(world.idAt(4, 3)).toBe(cutter);
    expect(world.kindAt(4, 2)).toBe(TileKind.Empty);
    expect(world.idAt(5, 2)).toBe(remainder);
    expect(world.idAt(6, 2)).toBe(end);
    expect(world.componentStateSnapshotAt(5, 2)).toEqual(state);
    expect(world.isWelded(5, 2, 6, 2)).toBe(true);
    expect(world.isWelded(4, 2, 5, 2)).toBe(false);
    expect(world.isWelded(3, 3, 4, 3)).toBe(true);
    expect(effects.get(2 * world.width + 4)?.kind).toBe(TileKind.Stone);
  });

  it("lets a static destroyer remove a swept moving head without becoming captured", () => {
    const world = rotatorWorld();
    world.place(3, 2, TileKind.Stone);
    world.setWeld(3, 3, 3, 2, true);
    const cutter = world.place(4, 2, TileKind.Destroyer);
    const effects = watchShatterAnimation(world);
    const activity = watchMachineryActivity(world);

    new RotatorResolver(world).resolve();

    expect(world.kindAt(3, 2)).toBe(TileKind.Empty);
    expect(world.kindAt(4, 3)).toBe(TileKind.Empty);
    expect(world.idAt(4, 2)).toBe(cutter);
    expect(world.rotatorDirectionAtIndex(3 * world.width + 3)).toBe(Direction.Right);
    expect(world.isWelded(3, 3, 3, 2)).toBe(false);
    expect(world.isWelded(3, 3, 4, 3)).toBe(false);
    expect(effects.get(2 * world.width + 4)?.kind).toBe(TileKind.Stone);
    expect(activity).toEqual([{ voice: "break", index: 2 * world.width + 4 }]);
  });

  it("rotates surviving fragments after a static cutter severs the original carried body", () => {
    const world = rotatorWorld();
    world.place(3, 2, TileKind.Stone);
    world.place(3, 1, TileKind.Stone);
    const survivor = world.place(3, 0, TileKind.Counter);
    world.restoreComponentState(3, 0, { type: "counter", threshold: 7, count: 3 });
    world.setWeld(3, 3, 3, 2, true);
    world.setWeld(3, 2, 3, 1, true);
    world.setWeld(3, 1, 3, 0, true);
    const cutter = world.place(4, 2, TileKind.Destroyer);

    new RotatorResolver(world).resolve();

    expect(world.idAt(6, 3)).toBe(survivor);
    expect(world.componentStateSnapshotAt(6, 3)).toEqual({ type: "counter", threshold: 7, count: 3 });
    expect(world.idAt(4, 2)).toBe(cutter);
    expect(world.kindAt(4, 3)).toBe(TileKind.Empty);
    expect(world.kindAt(5, 3)).toBe(TileKind.Empty);
    expect(world.isWelded(3, 3, 4, 3)).toBe(false);
    expect(world.isWelded(5, 3, 6, 3)).toBe(false);
  });

  it("can cut a carried active empty-grip actuator without updating a replacement component", () => {
    const world = rotatorWorld();
    world.place(3, 2, TileKind.Rotator, Direction.Up);
    world.setCharge(3, 2, 1);
    world.setWeld(3, 3, 3, 2, true);
    const cutter = world.place(4, 2, TileKind.Destroyer);

    new RotatorResolver(world).resolve();

    expect(world.kindAt(3, 2)).toBe(TileKind.Empty);
    expect(world.componentStateSnapshotAt(3, 2)).toBeNull();
    expect(world.idAt(4, 2)).toBe(cutter);
    expect(world.componentStateSnapshotAt(3, 3)).toEqual({ type: "rotator", direction: Direction.Right });
    expect(world.isWelded(3, 3, 4, 3)).toBe(false);
  });

  it("removes both mutually swept destroyers and leaves the surviving actuator valid", () => {
    const world = rotatorWorld();
    world.place(3, 2, TileKind.Destroyer);
    world.place(4, 2, TileKind.Destroyer);
    world.setWeld(3, 3, 3, 2, true);
    const activity = watchMachineryActivity(world);

    new RotatorResolver(world).resolve();

    expect(world.kindAt(3, 2)).toBe(TileKind.Empty);
    expect(world.kindAt(4, 2)).toBe(TileKind.Empty);
    expect(world.kindAt(4, 3)).toBe(TileKind.Empty);
    expect(world.componentStateSnapshotAt(3, 3)).toEqual({ type: "rotator", direction: Direction.Right });
    expect(world.isWelded(3, 3, 4, 3)).toBe(false);
    expect(activity).toEqual([
      { voice: "break", index: 2 * world.width + 4 },
      { voice: "break", index: 2 * world.width + 4 },
    ]);
  });

  it.each([
    [TileKind.Destroyer, TileKind.IndestructibleConduit],
    [TileKind.IndestructibleConduit, TileKind.Destroyer],
  ])("captures an immune sweep %s against %s normally instead of destroying it", (source, target) => {
    const world = rotatorWorld();
    const carried = world.place(3, 2, source);
    const captured = world.place(4, 2, target);
    world.setWeld(3, 3, 3, 2, true);
    const activity = watchMachineryActivity(world);

    new RotatorResolver(world).resolve();

    expect(world.idAt(4, 3)).toBe(carried);
    expect(world.idAt(4, 4)).toBe(captured);
    expect(world.isWelded(3, 3, 4, 3)).toBe(true);
    expect(activity).toEqual([]);
  });

  it("keeps all prospective cuts and head welds intact when terrain blocks both turn and reaction", () => {
    const world = rotatorWorld();
    world.place(3, 2, TileKind.Destroyer);
    world.place(4, 2, TileKind.Stone);
    world.place(4, 3, TileKind.Platform);
    world.place(3, 4, TileKind.Platform);
    world.setWeld(3, 3, 3, 2, true);
    world.setWeld(3, 3, 3, 4, true);
    const before = serializeBoard(world, 0);
    const activity = watchMachineryActivity(world);

    expect(new RotatorResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
    expect(activity).toEqual([]);
  });

  it("jams destructive rival sweeps before either can cut the shared victim", () => {
    const world = new World(8, 7);
    for (const x of [2, 4]) {
      world.place(x, 3, TileKind.Rotator, Direction.Up);
      world.place(x, 2, TileKind.Destroyer);
      world.setWeld(x, 3, x, 2, true);
      world.setCharge(x, 3, x === 2 ? 1 : -1);
    }
    world.place(3, 2, TileKind.Stone);
    const before = serializeBoard(world, 0);
    const effects = watchShatterAnimation(world);

    expect(new RotatorResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
    expect(effects.size).toBe(0);
  });

  it("does not mistake a co-moving destroyer's old position for a static cutter", () => {
    const world = rotatorWorld();
    const head = world.place(3, 2, TileKind.Stone);
    const cutter = world.place(4, 2, TileKind.Destroyer);
    world.setWeld(3, 3, 3, 2, true);
    world.setWeld(3, 2, 4, 2, true);
    const activity = watchMachineryActivity(world);

    new RotatorResolver(world).resolve();

    expect(world.idAt(4, 3)).toBe(head);
    expect(world.idAt(4, 4)).toBe(cutter);
    expect(world.kindAt(3, 2)).toBe(TileKind.Empty);
    expect(world.kindAt(4, 2)).toBe(TileKind.Empty);
    expect(world.isWelded(3, 3, 4, 3)).toBe(true);
    expect(world.isWelded(4, 3, 4, 4)).toBe(true);
    expect(activity).toEqual([]);
  });

  it("still captures ordinary swept bodies while a different carried tile makes a cut", () => {
    const world = rotatorWorld();
    const head = world.place(3, 2, TileKind.Stone);
    const cutter = world.place(3, 1, TileKind.Destroyer);
    world.setWeld(3, 2, 3, 1, true);
    const captured = world.place(4, 3, TileKind.Conduit);
    world.place(4, 1, TileKind.Stone);

    new RotatorResolver(world).resolve();

    expect(world.idAt(4, 3)).toBe(head);
    expect(world.idAt(5, 3)).toBe(cutter);
    expect(world.idAt(3, 4)).toBe(captured);
    expect(world.kindAt(4, 1)).toBe(TileKind.Empty);
    expect(world.isWelded(4, 3, 5, 3)).toBe(true);
  });
});
