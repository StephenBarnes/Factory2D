import { describe, expect, it } from "vitest";

import { serializeBoard } from "../src/simulation/board-export";
import { FlipperResolver } from "../src/simulation/flipper-resolver";
import { Simulation } from "../src/simulation/simulation";
import { Direction, directionX, directionY, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function poweredFlipper(world: World, x: number, y: number): void {
  world.place(x, y, TileKind.Flipper, Direction.Up);
  world.place(x, y + 1, TileKind.FixedCharge);
  world.place(x, y + 2, TileKind.Platform);
  world.setWeld(x, y, x, y + 1, true);
  world.setWeld(x, y + 1, x, y + 2, true);
}

describe("flippers", () => {
  it("reflects the example's welded pair around the front cell, not the machine", () => {
    const world = new World(5, 3);
    world.place(2, 2, TileKind.Flipper, Direction.Up);
    const left = world.place(1, 1, TileKind.Stone);
    const pivot = world.place(2, 1, TileKind.Stone);
    world.setWeld(1, 1, 2, 1, true);
    world.setCharge(2, 2, 1);

    expect(new FlipperResolver(world).resolve()).toBe(2);
    expect(world.idAt(2, 1)).toBe(pivot);
    expect(world.idAt(3, 1)).toBe(left);
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.isWelded(2, 1, 3, 1)).toBe(true);
  });

  it.each([Direction.Up, Direction.Right, Direction.Down, Direction.Left])(
    "uses global signed axes regardless of facing or handedness at orientation %s",
    (orientation) => {
      for (const charge of [-1, 1] as const) {
        const world = new World(11, 11);
        world.place(5, 5, TileKind.Flipper, orientation, true);
        const dx = directionX(orientation);
        const dy = directionY(orientation);
        const px = 5 + dx;
        const py = 5 + dy;
        const ax = px - dy;
        const ay = py + dx;
        const bx = ax + dx;
        const by = ay + dy;
        const pivot = world.place(px, py, TileKind.Stone);
        world.place(ax, ay, TileKind.Stone);
        const tip = world.place(bx, by, TileKind.Selector, Direction.Right);
        world.setWeld(5, 5, px, py, true);
        world.setWeld(px, py, ax, ay, true);
        world.setWeld(ax, ay, bx, by, true);
        world.setCharge(5, 5, charge);
        const reflectedX = charge === 1 ? 2 * px - bx : bx;
        const reflectedY = charge === -1 ? 2 * py - by : by;

        expect(new FlipperResolver(world).resolve()).toBe(3);
        expect(world.idAt(px, py)).toBe(pivot);
        expect(world.idAt(reflectedX, reflectedY)).toBe(tip);
        expect(world.orientationAt(reflectedX, reflectedY))
          .toBe(charge === 1 ? Direction.Left : Direction.Right);
        expect(world.mirroredAt(reflectedX, reflectedY)).toBe(true);
        expect(world.isWelded(5, 5, px, py)).toBe(true);
      }
    },
  );

  it("leaves empty and neutral machines inert", () => {
    const world = new World(7, 5);
    world.place(1, 3, TileKind.Flipper, Direction.Up);
    world.setCharge(1, 3, 1);
    world.place(4, 3, TileKind.Flipper, Direction.Up);
    world.place(4, 2, TileKind.Selector, Direction.Right);
    world.setWeld(4, 3, 4, 2, true);
    const before = serializeBoard(world, 0);

    expect(new FlipperResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
  });

  it("uses freshly resolved rear power, isolates its welded head, and flips on every powered tick", () => {
    const world = new World(7, 7);
    poweredFlipper(world, 3, 3);
    const head = world.place(3, 2, TileKind.Conduit);
    const arm = world.place(4, 2, TileKind.Conduit);
    world.setWeld(3, 3, 3, 2, true);
    world.setWeld(3, 2, 4, 2, true);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);
    expect(world.idAt(2, 2)).toBe(arm);
    expect(world.chargeAt(3, 3)).toBe(1);
    expect(world.chargeAt(3, 2)).toBe(0);
    expect(world.chargeAt(2, 2)).toBe(0);
    expect(world.isWelded(3, 3, 3, 2)).toBe(true);
    expect(simulation.step()).toBe(2);
    expect(world.idAt(4, 2)).toBe(arm);
    expect(world.idAt(3, 2)).toBe(head);
    expect(world.isWelded(3, 2, 4, 2)).toBe(true);

    world.setWeld(3, 3, 3, 4, false);
    expect(simulation.step()).toBe(0);
    expect(world.chargeAt(3, 3)).toBe(0);
    expect(world.idAt(4, 2)).toBe(arm);
    expect(world.isWelded(3, 3, 3, 2)).toBe(true);
  });

  it("resolves negative rear power into repeated vertical flips in the same tick", () => {
    const world = new World(7, 8);
    world.place(3, 3, TileKind.Flipper, Direction.Up);
    world.place(3, 4, TileKind.Inverter, Direction.Up);
    world.place(3, 5, TileKind.FixedCharge);
    world.place(3, 6, TileKind.Platform);
    for (let y = 3; y < 6; y += 1) world.setWeld(3, y, 3, y + 1, true);
    world.place(3, 2, TileKind.Stone);
    world.place(4, 2, TileKind.Stone);
    const tip = world.place(4, 1, TileKind.Selector, Direction.Up);
    world.setWeld(3, 3, 3, 2, true);
    world.setWeld(3, 2, 4, 2, true);
    world.setWeld(4, 2, 4, 1, true);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);
    expect(world.chargeAt(3, 3)).toBe(0);

    expect(simulation.step()).toBe(3);
    expect(world.chargeAt(3, 3)).toBe(-1);
    expect(world.idAt(4, 3)).toBe(tip);
    expect(world.orientationAt(4, 3)).toBe(Direction.Down);
    expect(world.isWelded(3, 3, 3, 2)).toBe(true);
    expect(simulation.step()).toBe(3);
    expect(world.idAt(4, 1)).toBe(tip);
    expect(world.orientationAt(4, 1)).toBe(Direction.Up);
    expect(world.isWelded(4, 1, 4, 2)).toBe(true);
  });

  it("does not accept power from a welded front source", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Flipper, Direction.Up);
    world.place(3, 4, TileKind.Platform);
    world.setWeld(3, 3, 3, 4, true);
    world.place(3, 2, TileKind.FixedCharge);
    const arm = world.place(4, 2, TileKind.Conduit);
    world.setWeld(3, 3, 3, 2, true);
    world.setWeld(3, 2, 4, 2, true);

    expect(new Simulation(world).step()).toBe(0);
    expect(world.chargeAt(3, 3)).toBe(0);
    expect(world.chargeAt(4, 2)).toBe(1);
    expect(world.idAt(4, 2)).toBe(arm);
  });

  it.each([TileKind.Stone, TileKind.Platform])(
    "rejects an occupied destination of kind %s without changing either weld seam",
    (obstacle) => {
      const world = new World(7, 6);
      world.place(3, 3, TileKind.Flipper, Direction.Up);
      world.place(3, 4, TileKind.Stone);
      world.place(3, 2, TileKind.Stone);
      world.place(4, 2, TileKind.Stone);
      world.place(2, 2, obstacle);
      world.setWeld(3, 3, 3, 4, true);
      world.setWeld(3, 3, 3, 2, true);
      world.setWeld(3, 2, 4, 2, true);
      world.setCharge(3, 3, 1);
      const before = serializeBoard(world, 0);

      expect(new FlipperResolver(world).resolve()).toBe(0);
      expect(serializeBoard(world, 0)).toBe(before);
    },
  );

  it("rejects a boundary crossing without detaching the head", () => {
    const world = new World(5, 4);
    world.place(0, 2, TileKind.Flipper, Direction.Up);
    world.place(0, 1, TileKind.Stone);
    world.place(1, 1, TileKind.Stone);
    world.setWeld(0, 2, 0, 1, true);
    world.setWeld(0, 1, 1, 1, true);
    world.setCharge(0, 2, 1);
    const before = serializeBoard(world, 0);

    expect(new FlipperResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
  });

  it("cannot reflect a fixed pivot even when the fixed tile would stay in place", () => {
    const world = new World(7, 6);
    world.place(3, 3, TileKind.Flipper, Direction.Up);
    world.place(3, 2, TileKind.Platform);
    world.place(4, 2, TileKind.Stone);
    world.setWeld(3, 3, 3, 2, true);
    world.setWeld(3, 2, 4, 2, true);
    world.setCharge(3, 3, 1);
    const before = serializeBoard(world, 0);

    expect(new FlipperResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
  });

  it("does not invent a head weld for an unwelded load", () => {
    const world = new World(7, 6);
    world.place(3, 3, TileKind.Flipper, Direction.Up);
    const head = world.place(3, 2, TileKind.Piston, Direction.Up);
    world.setCharge(3, 3, -1);

    expect(new FlipperResolver(world).resolve()).toBe(1);
    expect(world.idAt(3, 2)).toBe(head);
    expect(world.orientationAt(3, 2)).toBe(Direction.Down);
    expect(world.isWelded(3, 3, 3, 2)).toBe(false);
  });

  it("rejects a reflected head whose facing would prohibit restoring the existing seam", () => {
    const world = new World(7, 6);
    world.place(3, 3, TileKind.Flipper, Direction.Up);
    world.place(3, 2, TileKind.Magnet, Direction.Up);
    world.setWeld(3, 3, 3, 2, true);
    world.setCharge(3, 3, -1);
    const before = serializeBoard(world, 0);

    expect(new FlipperResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
  });

  it.each(["weld", "magic link"] as const)(
    "reflects its own base when an alternate %s path reaches it after the head seam is split",
    (connection) => {
      const world = new World(9, 9);
      const base = world.place(4, 4, TileKind.Flipper, Direction.Up);
      const head = world.place(4, 3, TileKind.Stone);
      const rear = world.place(4, 5, TileKind.Stone);
      world.setWeld(4, 4, 4, 3, true);
      world.setWeld(4, 4, 4, 5, true);
      if (connection === "weld") {
        for (const y of [3, 4, 5]) world.place(3, y, TileKind.Stone);
        world.setWeld(3, 3, 3, 4, true);
        world.setWeld(3, 4, 3, 5, true);
      } else {
        world.place(3, 3, TileKind.MagicLink, Direction.Down);
        world.place(3, 5, TileKind.MagicLink, Direction.Up);
      }
      world.setWeld(4, 3, 3, 3, true);
      world.setWeld(4, 5, 3, 5, true);
      world.setCharge(4, 4, -1);

      expect(new FlipperResolver(world).resolve()).toBe(connection === "weld" ? 6 : 5);
      expect(world.idAt(4, 2)).toBe(base);
      expect(world.orientationAt(4, 2)).toBe(Direction.Down);
      expect(world.idAt(4, 3)).toBe(head);
      expect(world.idAt(4, 1)).toBe(rear);
      expect(world.isWelded(4, 2, 4, 3)).toBe(true);
      expect(world.isWelded(4, 2, 4, 1)).toBe(true);
      expect(world.isWelded(4, 1, 3, 1)).toBe(true);
      expect(world.kindAt(4, 4)).toBe(TileKind.Empty);
    },
  );

  it("carries magic-linked remote bodies but not loose tiles between their final positions", () => {
    const world = new World(13, 7);
    world.place(6, 4, TileKind.Flipper, Direction.Up);
    const near = world.place(6, 3, TileKind.MagicLink, Direction.Right);
    const remote = world.place(10, 3, TileKind.MagicLink, Direction.Left);
    const load = world.place(10, 2, TileKind.Selector, Direction.Right);
    world.setWeld(10, 3, 10, 2, true);
    const loose = world.place(7, 3, TileKind.Stone);
    const terrain = world.place(5, 3, TileKind.Platform);
    world.setCharge(6, 4, 1);

    expect(new FlipperResolver(world).resolve()).toBe(3);
    expect(world.idAt(6, 3)).toBe(near);
    expect(world.orientationAt(6, 3)).toBe(Direction.Left);
    expect(world.idAt(2, 3)).toBe(remote);
    expect(world.orientationAt(2, 3)).toBe(Direction.Right);
    expect(world.idAt(2, 2)).toBe(load);
    expect(world.isWelded(2, 3, 2, 2)).toBe(true);
    expect(world.idAt(7, 3)).toBe(loose);
    expect(world.idAt(5, 3)).toBe(terrain);
  });

  it.each([2, 3])("jams all %s claimants of a shared destination, including a late third claimant", (count) => {
    const world = new World(9, 8);
    for (const [pivot, step] of [[2, -1], [6, 1]] as const) {
      world.place(pivot, 3, TileKind.Flipper, Direction.Up);
      world.setCharge(pivot, 3, 1);
      for (let offset = 0; offset < 3; offset += 1) {
        world.place(pivot + step * offset, 2, TileKind.Stone);
        if (offset > 0) world.setWeld(pivot + step * (offset - 1), 2, pivot + step * offset, 2, true);
      }
      world.setWeld(pivot, 3, pivot, 2, true);
    }
    if (count === 3) {
      world.place(3, 4, TileKind.Flipper, Direction.Right);
      world.setCharge(3, 4, -1);
      for (const y of [4, 5, 6]) world.place(4, y, TileKind.Stone);
      world.setWeld(4, 4, 4, 5, true);
      world.setWeld(4, 5, 4, 6, true);
      world.setWeld(3, 4, 4, 4, true);
    }
    const before = serializeBoard(world, 0);

    expect(new FlipperResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
  });

  it("jams machines targeting the same source even when that source is reflection-invariant", () => {
    const world = new World(7, 6);
    world.place(3, 2, TileKind.Stone);
    for (const [x, y, facing] of [
      [3, 3, Direction.Up], [2, 2, Direction.Right], [3, 1, Direction.Down],
    ] as const) {
      world.place(x, y, TileKind.Flipper, facing);
      world.setCharge(x, y, 1);
    }
    const before = serializeBoard(world, 0);

    expect(new FlipperResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
  });

  it("jams a flip carrying another active machine even when their loads are disjoint", () => {
    const world = new World(8, 6);
    world.place(3, 3, TileKind.Flipper, Direction.Up);
    world.place(3, 2, TileKind.Stone);
    world.place(4, 2, TileKind.Flipper, Direction.Up);
    world.place(4, 1, TileKind.Stone);
    // The second machine's rear connects it to the first load without welding its head.
    for (const [x, y] of [[2, 2], [2, 3], [2, 4], [3, 4], [4, 4], [4, 3]] as const) {
      world.place(x, y, TileKind.Stone);
    }
    world.setWeld(3, 2, 2, 2, true);
    world.setWeld(2, 2, 2, 3, true);
    world.setWeld(2, 3, 2, 4, true);
    world.setWeld(2, 4, 3, 4, true);
    world.setWeld(3, 4, 4, 4, true);
    world.setWeld(4, 4, 4, 3, true);
    world.setWeld(4, 3, 4, 2, true);
    world.setCharge(3, 3, 1);
    world.setCharge(4, 2, -1);
    const before = serializeBoard(world, 0);

    expect(new FlipperResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
  });

  it("does not let a blocked proposal jam a viable competitor for the same destination", () => {
    const world = new World(6, 5);
    for (const x of [1, 3]) {
      world.place(x, 3, TileKind.Flipper, Direction.Up);
      world.place(x, 2, TileKind.Stone);
      world.setWeld(x, 3, x, 2, true);
      world.setCharge(x, 3, 1);
    }
    const blocked = world.place(0, 2, TileKind.Stone);
    world.place(0, 1, TileKind.Stone);
    world.setWeld(1, 2, 0, 2, true);
    world.setWeld(0, 2, 0, 1, true);
    world.place(2, 1, TileKind.Platform);
    const accepted = world.place(4, 2, TileKind.Stone);
    world.setWeld(3, 2, 4, 2, true);

    expect(new FlipperResolver(world).resolve()).toBe(2);
    expect(world.idAt(2, 2)).toBe(accepted);
    expect(world.idAt(0, 2)).toBe(blocked);
    expect(world.isWelded(1, 3, 1, 2)).toBe(true);
    expect(world.isWelded(1, 2, 0, 2)).toBe(true);
    expect(world.isWelded(3, 3, 3, 2)).toBe(true);
    expect(world.isWelded(3, 2, 2, 2)).toBe(true);
  });

  it("rejects a partial welded selection atomically before reflecting component state", () => {
    const world = new World(6, 5);
    const rom = world.place(2, 2, TileKind.Rom, Direction.Right);
    world.restoreComponentState(2, 2, {
      type: "rom", width: 2, height: 2, cursor: 0,
      wrapX: false, wrapY: true, values: [1, 0, -1, 1],
    });
    const selectedStone = world.place(3, 2, TileKind.Stone);
    world.place(4, 2, TileKind.Stone);
    world.setWeld(2, 2, 3, 2, true);
    world.setWeld(3, 2, 4, 2, true);
    const selected = new Uint8Array(world.cellCount);
    selected[2 * world.width + 2] = 1;
    selected[2 * world.width + 3] = 1;
    const before = serializeBoard(world, 0);

    expect(() => world.flipCells(selected, 2 * world.width + 2, true)).toThrow();
    expect(serializeBoard(world, 0)).toBe(before);
    expect(world.idAt(2, 2)).toBe(rom);
    expect(world.idAt(3, 2)).toBe(selectedStone);
  });

  it("preserves identities while reflecting asymmetric tiles, circuit axes, ROM state, and nested worlds", () => {
    const world = new World(9, 7);
    world.place(4, 4, TileKind.Flipper, Direction.Up);
    const rom = world.place(4, 3, TileKind.Rom, Direction.Right);
    world.restoreComponentState(4, 3, {
      type: "rom", width: 2, height: 2, cursor: 0,
      wrapX: false, wrapY: true, values: [1, 0, -1, 1],
    });
    const array = world.place(5, 3, TileKind.RuneArray);
    world.configureRuneArray(5, 3, 3, 3, "nested load");
    const inner = world.runeArrayWorldAt(5, 3);
    inner.place(0, 1, TileKind.Assembler, Direction.Right);
    inner.restoreComponentState(0, 1, {
      type: "assembler", pending: [{ kind: TileKind.Selector, orientation: Direction.Right }],
    });
    inner.place(0, 0, TileKind.RuneArray);
    inner.configureRuneArray(0, 0, 3, 3, "deeper");
    inner.runeArrayWorldAt(0, 0).place(0, 2, TileKind.Selector, Direction.Right);
    const crossing = world.place(6, 3, TileKind.WireCrossing);
    world.setCrossingCharges(6, 3, 1, -1);
    const selector = world.place(7, 3, TileKind.Selector, Direction.Right);
    for (let x = 4; x < 7; x += 1) world.setWeld(x, 3, x + 1, 3, true);
    world.setWeld(4, 4, 4, 3, true);
    world.setCharge(4, 4, 1);

    expect(new FlipperResolver(world).resolve()).toBe(4);
    expect(world.idAt(4, 3)).toBe(rom);
    expect(world.orientationAt(4, 3)).toBe(Direction.Left);
    expect(world.componentStateSnapshotAt(4, 3)).toEqual({
      type: "rom", width: 2, height: 2, cursor: 1,
      wrapX: false, wrapY: true, values: [0, 1, 1, -1],
    });
    expect(world.idAt(3, 3)).toBe(array);
    const reflected = world.runeArrayWorldAt(3, 3);
    expect(reflected.kindAt(2, 1)).toBe(TileKind.Assembler);
    expect(reflected.orientationAt(2, 1)).toBe(Direction.Left);
    expect(reflected.componentStateSnapshotAt(2, 1)).toEqual({
      type: "assembler", pending: [{ kind: TileKind.Selector, orientation: Direction.Left, mirrored: true }],
    });
    const deeper = reflected.runeArrayWorldAt(2, 0);
    expect(deeper.kindAt(2, 2)).toBe(TileKind.Selector);
    expect(deeper.orientationAt(2, 2)).toBe(Direction.Left);
    expect(deeper.mirroredAt(2, 2)).toBe(true);
    expect(world.idAt(2, 3)).toBe(crossing);
    expect(world.chargeAtPort(2, 3, Direction.Right)).toBe(1);
    expect(world.chargeAtPort(2, 3, Direction.Up)).toBe(-1);
    expect(world.idAt(1, 3)).toBe(selector);
    expect(world.orientationAt(1, 3)).toBe(Direction.Left);
    expect(world.mirroredAt(1, 3)).toBe(true);
    for (let x = 1; x < 4; x += 1) expect(world.isWelded(x, 3, x + 1, 3)).toBe(true);
    expect(world.isWelded(4, 4, 4, 3)).toBe(true);
  });

  it.each([false, true])("breaks fasteners only after accepted reflections (blocked: %s)", (blocked) => {
    const world = new World(7, 7);
    poweredFlipper(world, 3, 3);
    const fastener = world.place(3, 2, TileKind.Fastener);
    const load = world.place(4, 2, TileKind.Stone);
    world.setWeld(3, 3, 3, 2, true);
    world.setWeld(3, 2, 4, 2, true);
    if (blocked) world.place(2, 2, TileKind.Platform);

    new Simulation(world).step();

    if (blocked) {
      expect(world.idAt(3, 2)).toBe(fastener);
      expect(world.idAt(4, 2)).toBe(load);
      expect(world.isWelded(3, 3, 3, 2)).toBe(true);
      expect(world.isWelded(3, 2, 4, 2)).toBe(true);
    } else {
      expect(world.kindAt(3, 2)).toBe(TileKind.Empty);
      expect(world.idAt(2, 2)).toBe(load);
      expect(world.isWelded(3, 3, 3, 2)).toBe(false);
      expect(world.isWelded(3, 2, 2, 2)).toBe(false);
    }
  });
});
