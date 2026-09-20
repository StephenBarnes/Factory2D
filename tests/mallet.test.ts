import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";
import { BellObserver } from "../src/ui/bell-observer";

/** Move one unwelded source without moving the bodies it may strike. */
function moveSource(world: World, x: number, y: number, dx: number, dy: number): void {
  const roots = Int32Array.from({ length: world.cellCount }, (_, index) => index);
  const horizontal = new Int16Array(world.cellCount);
  const vertical = new Int16Array(world.cellCount);
  const source = y * world.width + x;
  horizontal[source] = dx;
  vertical[source] = dy;
  world.moveBodies(roots, horizontal, vertical);
}

function addReceiver(world: World, x: number, y: number): void {
  world.place(x, y, TileKind.Resonator);
  world.place(x + 1, y, TileKind.Conduit);
  world.setWeld(x, y, x + 1, y, true);
}

describe("mallet observations", () => {
  it("strikes downward under gravity at the target's pitch and site, while falling bells stay silent", () => {
    const world = new World(6, 4);
    world.place(0, 0, TileKind.Bell);
    world.place(1, 0, TileKind.Mallet);
    world.place(1, 2, TileKind.Platform);
    world.place(2, 2, TileKind.Stone);
    world.setWeld(1, 2, 2, 2, true);
    const sites: number[] = [];
    const observer = new BellObserver((_, index) => sites.push(index));
    const simulation = new Simulation(world);
    observer.capture(world);
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Mallet);
    expect(observer.collectSounds(world)).toEqual([{ voice: 1, world, index: 13 }]);
    expect(sites).toEqual([13]);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("strikes in the direction of horizontal thrust without replaying blocked motion", () => {
    const world = new World(6, 3);
    world.place(0, 0, TileKind.Thruster, Direction.Right);
    world.place(1, 0, TileKind.Mallet);
    world.setWeld(0, 0, 1, 0, true);
    world.place(3, 0, TileKind.Platform);
    const observer = new BellObserver();
    const simulation = new Simulation(world);
    observer.capture(world);
    simulation.step();
    expect(world.kindAt(2, 0)).toBe(TileKind.Mallet);
    expect(observer.collectSounds(world)).toEqual([{ voice: 0, world, index: 3 }]);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("does not strike its own falling welded body", () => {
    const world = new World(3, 4);
    world.place(1, 0, TileKind.Mallet);
    world.place(1, 1, TileKind.Stone);
    world.setWeld(1, 0, 1, 1, true);
    world.place(1, 3, TileKind.Platform);
    const observer = new BellObserver();
    observer.capture(world);
    new Simulation(world).step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Mallet);
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("uses final mechanical links both for struck-body pitch and own-body exclusion", () => {
    const world = new World(8, 4);
    world.place(0, 0, TileKind.Mallet);
    world.place(2, 1, TileKind.MagicLink, Direction.Right);
    world.place(5, 1, TileKind.MagicLink, Direction.Left);
    world.place(5, 2, TileKind.Stone);
    const observer = new BellObserver();
    observer.capture(world);
    moveSource(world, 0, 0, 1, 1);
    world.setWeld(5, 1, 5, 2, true);
    expect(observer.collectSounds(world)).toEqual([{ voice: 2, world, index: 10 }]);

    moveSource(world, 1, 1, -1, -1);
    observer.capture(world);
    moveSource(world, 0, 0, 1, 1);
    world.place(1, 2, TileKind.Stone);
    world.place(2, 2, TileKind.Stone);
    world.place(3, 2, TileKind.Stone);
    world.place(4, 2, TileKind.Stone);
    world.setWeld(1, 1, 1, 2, true);
    for (let x = 1; x < 5; x += 1) world.setWeld(x, 2, x + 1, 2, true);
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("strikes both moved axes but only once when their targets share a final body", () => {
    const world = new World(5, 4);
    world.place(0, 0, TileKind.Mallet);
    world.place(2, 1, TileKind.Platform);
    world.place(1, 2, TileKind.Platform);
    world.place(2, 2, TileKind.Stone);
    world.setWeld(1, 2, 2, 2, true);
    const observer = new BellObserver();
    observer.capture(world);
    moveSource(world, 0, 0, 1, 1);
    expect(observer.collectSounds(world)).toEqual([
      { voice: 0, world, index: 7 },
      { voice: 1, world, index: 11 },
    ]);
    moveSource(world, 1, 1, -1, -1);
    observer.capture(world);
    moveSource(world, 0, 0, 1, 1);
    world.setWeld(2, 1, 2, 2, true);
    expect(observer.collectSounds(world)).toEqual([{ voice: 2, world, index: 7 }]);
  });

  it("ignores net-zero trips, deleted sources, and new identities in reused cells", () => {
    const world = new World(4, 3);
    world.place(0, 0, TileKind.Mallet);
    world.place(2, 0, TileKind.Platform);
    const observer = new BellObserver();
    observer.capture(world);
    moveSource(world, 0, 0, 1, 0);
    moveSource(world, 1, 0, -1, 0);
    expect(observer.collectSounds(world)).toEqual([]);
    observer.capture(world);
    moveSource(world, 0, 0, 1, 0);
    world.place(1, 0, TileKind.Empty);
    world.place(0, 0, TileKind.Mallet);
    moveSource(world, 0, 0, 1, 0);
    expect(observer.collectSounds(world)).toEqual([]);
    observer.capture(world);
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("ignores open air and boundaries without wrapping a horizontal strike to the next row", () => {
    const world = new World(4, 3);
    world.place(0, 0, TileKind.Mallet);
    world.place(0, 1, TileKind.Platform);
    const observer = new BellObserver();
    observer.capture(world);
    moveSource(world, 0, 0, 1, 0);
    expect(observer.collectSounds(world)).toEqual([]);
    observer.capture(world);
    moveSource(world, 1, 0, 2, 0);
    expect(observer.collectSounds(world)).toEqual([]);
    observer.capture(world);
    moveSource(world, 3, 0, 0, 2);
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("delivers a matching resonator pulse on the next tick and preserves that pulse through save/load", () => {
    const world = new World(7, 4);
    world.place(0, 0, TileKind.Mallet);
    world.place(0, 2, TileKind.Platform);
    world.place(1, 2, TileKind.Stone);
    world.setWeld(0, 2, 1, 2, true);
    addReceiver(world, 4, 3);
    world.place(3, 3, TileKind.Resonator);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.chargeAt(5, 3)).toBe(0);
    const loaded = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    expect(loaded.kindAt(0, 1)).toBe(TileKind.Mallet);
    simulation.step();
    expect(world.chargeAt(5, 3)).toBe(1);
    expect(world.chargeAt(3, 3)).toBe(0);
    simulation.step();
    expect(world.chargeAt(5, 3)).toBe(0);
    const restored = new Simulation(loaded);
    restored.step();
    expect(loaded.chargeAt(5, 3)).toBe(1);
    restored.step();
    expect(loaded.chargeAt(5, 3)).toBe(0);
  });

  it("keeps strikes and hearing local to nested boards rather than moving array carriers", () => {
    const world = new World(9, 5);
    world.place(0, 0, TileKind.Mallet);
    world.place(0, 2, TileKind.Platform);
    world.place(8, 4, TileKind.Resonator);
    world.place(3, 0, TileKind.RuneArray);
    world.place(4, 0, TileKind.Thruster, Direction.Right);
    world.setWeld(3, 0, 4, 0, true);
    const inner = world.runeArrayWorldAt(3, 0);
    inner.place(4, 4, TileKind.Resonator);
    inner.place(0, 2, TileKind.Mallet);
    inner.place(0, 3, TileKind.Platform);
    const simulation = new Simulation(world);
    const observer = new BellObserver();
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([{ voice: 0, world, index: 18 }]);
    simulation.step();
    expect(world.chargeAt(8, 4)).toBe(1);
    expect(inner.chargeAt(4, 4)).toBe(0);

    inner.place(1, 0, TileKind.Mallet);
    inner.place(1, 2, TileKind.Platform);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([
      { voice: 0, world: inner, index: 2 * inner.width + 1 },
    ]);
    simulation.step();
    expect(inner.chargeAt(4, 4)).toBe(1);
    expect(world.chargeAt(8, 4)).toBe(0);
  });
});
