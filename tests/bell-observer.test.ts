import { describe, expect, it } from "vitest";

import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";
import { BellObserver } from "../src/ui/bell-observer";

/** Commit a translation while preserving tile identity and welds. */
function translate(world: World, x: number, y: number): void {
  const roots = new Int32Array(world.cellCount);
  const horizontal = new Int16Array(world.cellCount);
  const vertical = new Int16Array(world.cellCount);
  horizontal[0] = x;
  vertical[0] = y;
  world.moveBodies(roots, horizontal, vertical);
}

describe("bell observations", () => {
  it("rings for horizontal thrust but not gravity or a stationary tick", () => {
    const world = new World(6, 4);
    world.place(1, 0, TileKind.Bell);
    const simulation = new Simulation(world);
    const observer = new BellObserver();
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([]);

    world.place(2, 1, TileKind.Thruster, Direction.Right);
    world.setWeld(1, 1, 2, 1, true);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([{ voice: 1, world, index: 8 }]);

    observer.capture(world);
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("uses net local x displacement, including diagonal moves and return trips", () => {
    const world = new World(7, 5);
    world.place(2, 1, TileKind.Bell);
    const observer = new BellObserver();
    observer.capture(world);
    translate(world, -1, 1);
    expect(observer.collectSounds(world)).toEqual([{ voice: 0, world, index: 15 }]);

    observer.capture(world);
    translate(world, 3, 1);
    translate(world, -3, 0);
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("rings for a rotator's horizontal displacement", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    world.place(3, 4, TileKind.FixedCharge);
    world.place(3, 5, TileKind.Platform);
    world.setWeld(3, 3, 3, 4, true);
    world.setWeld(3, 4, 3, 5, true);
    world.place(4, 4, TileKind.Platform);
    world.place(3, 2, TileKind.Bell);
    const observer = new BellObserver();
    observer.capture(world);
    new Simulation(world).step();
    expect(observer.collectSounds(world)).toEqual([{ voice: 0, world, index: 25 }]);
  });

  it("retains equal-pitch bell sites across all three octaves", () => {
    const sizes = [1, 3, 8, 9, 15, 32, 33, 36, 37];
    const world = new World(38, sizes.length);
    for (const [y, size] of sizes.entries()) {
      for (let x = 0; x < size; x += 1) {
        world.place(x, y, x < 2 ? TileKind.Bell : TileKind.Stone);
        if (x > 0) world.setWeld(x - 1, y, x, y, true);
      }
    }
    const observer = new BellObserver();
    observer.capture(world);
    translate(world, 1, 0);
    expect(observer.collectSounds(world)).toEqual(sizes.flatMap((size, y) =>
      Array.from({ length: Math.min(size, 2) }, (_, x) => ({
        voice: size - 1,
        world,
        index: y * world.width + x + 1,
      }))));
  });

  it.each([37, 38])("clamps a %i-block body at F2", (size) => {
    const world = new World(size + 1, 1);
    for (let x = 0; x < size; x += 1) {
      world.place(x, 0, x === 0 ? TileKind.Bell : TileKind.Stone);
      if (x > 0) world.setWeld(x - 1, 0, x, 0, true);
    }
    const observer = new BellObserver();
    observer.capture(world);
    translate(world, 1, 0);
    expect(observer.collectSounds(world)).toEqual([{ voice: 36, world, index: 1 }]);
  });

  it("uses final weld topology and refreshes retained body membership", () => {
    const world = new World(6, 1);
    world.place(0, 0, TileKind.Bell);
    world.place(1, 0, TileKind.Stone);
    const observer = new BellObserver();
    observer.capture(world);
    translate(world, 1, 0);
    world.setWeld(1, 0, 2, 0, true);
    expect(observer.collectSounds(world)).toEqual([{ voice: 1, world, index: 1 }]);

    observer.capture(world);
    translate(world, 1, 0);
    world.setWeld(2, 0, 3, 0, false);
    expect(observer.collectSounds(world)).toEqual([{ voice: 0, world, index: 2 }]);
  });

  it("includes mechanically linked remote tiles in the final body size", () => {
    const world = new World(8, 1);
    world.place(0, 0, TileKind.Bell);
    world.place(1, 0, TileKind.MagicLink, Direction.Right);
    world.setWeld(0, 0, 1, 0, true);
    world.place(4, 0, TileKind.MagicLink, Direction.Left);
    world.place(5, 0, TileKind.Stone);
    world.setWeld(4, 0, 5, 0, true);
    const observer = new BellObserver();
    observer.capture(world);
    translate(world, 1, 0);
    expect(observer.collectSounds(world)).toEqual([{ voice: 3, world, index: 1 }]);
  });

  it("does not ring for deleted bells or newly created bells that move", () => {
    const world = new World(6, 1);
    world.place(0, 0, TileKind.Bell);
    world.place(2, 0, TileKind.Bell);
    const observer = new BellObserver();
    observer.capture(world);
    translate(world, 1, 0);
    world.place(1, 0, TileKind.Empty);
    world.place(3, 0, TileKind.Empty);
    world.place(0, 0, TileKind.Bell);
    translate(world, 1, 0);
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("observes recursive local boards without ringing for carrier movement", () => {
    const world = new World(6, 1);
    world.place(0, 0, TileKind.RuneArray);
    const inner = world.runeArrayWorldAt(0, 0);
    inner.place(0, 0, TileKind.RuneArray);
    const deepest = inner.runeArrayWorldAt(0, 0);
    deepest.place(0, 0, TileKind.Bell);
    inner.place(0, 2, TileKind.Bell);
    inner.place(1, 2, TileKind.Stone);
    inner.setWeld(0, 2, 1, 2, true);
    const observer = new BellObserver();
    observer.capture(world);
    translate(world, 1, 0);
    expect(observer.collectSounds(world)).toEqual([]);

    observer.capture(world);
    translate(world, 1, 0);
    translate(inner, 1, 0);
    translate(deepest, 1, 0);
    expect(observer.collectSounds(world)).toEqual([
      { voice: 1, world: inner, index: 2 * inner.width + 1 },
      { voice: 0, world: deepest, index: 1 },
    ]);
  });

  it("does not transfer observations to cloned inner worlds with matching IDs", () => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.RuneArray);
    const original = world.runeArrayWorldAt(0, 0);
    original.place(0, 0, TileKind.Bell);
    const observer = new BellObserver();
    observer.capture(world);
    translate(original, 1, 0);
    world.place(1, 0, TileKind.RuneArray);
    world.runeArrayWorldAt(1, 0).copyFrom(original);
    world.place(0, 0, TileKind.Empty);
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("consumes captures and lets a new capture supersede previous positions", () => {
    const world = new World(6, 1);
    world.place(0, 0, TileKind.Bell);
    const observer = new BellObserver();
    expect(observer.collectSounds(world)).toEqual([]);
    observer.capture(world);
    translate(world, 1, 0);
    observer.capture(world);
    expect(observer.collectSounds(world)).toEqual([]);

    observer.capture(world);
    translate(world, 1, 0);
    expect(observer.collectSounds(world)).toEqual([{ voice: 0, world, index: 2 }]);
    expect(observer.collectSounds(world)).toEqual([]);

    observer.capture(world);
    translate(world, 1, 0);
    observer.capture(new World(1, 1));
    expect(observer.collectSounds(world)).toEqual([]);
  });
});
