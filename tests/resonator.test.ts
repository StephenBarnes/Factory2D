import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";
import { WorldRuntime } from "../src/simulation/world-runtime";

function addBell(world: World): void {
  world.place(0, 0, TileKind.Bell);
  world.place(1, 0, TileKind.Thruster, Direction.Right);
  world.setWeld(0, 0, 1, 0, true);
}

function addReceiver(world: World, x = 0): void {
  const y = world.height - 1;
  world.place(x, y, TileKind.Resonator);
  world.place(x + 1, y, TileKind.Conduit);
  world.setWeld(x, y, x + 1, y, true);
}

function translate(world: World, dx: number): void {
  const roots = new Int32Array(world.cellCount);
  const horizontal = new Int16Array(world.cellCount);
  horizontal[0] = dx;
  world.moveBodies(roots, horizontal, new Int16Array(world.cellCount));
}

describe("resonators", () => {
  it("hears matching headless bell motion one tick later and clears without a held pulse", () => {
    const world = new World(9, 5);
    addBell(world);
    addReceiver(world);
    world.place(5, 4, TileKind.Resonator);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Bell);
    expect(world.chargeAt(1, 4)).toBe(0);
    world.place(1, 0, TileKind.Empty);
    world.place(2, 0, TileKind.Empty);
    simulation.step();
    expect(world.chargeAt(1, 4)).toBe(1);
    expect(world.chargeAt(5, 4)).toBe(0);
    simulation.step();
    expect(world.chargeAt(1, 4)).toBe(0);
  });

  it("does not hear vertical falls or stationary bells", () => {
    const world = new World(4, 4);
    world.place(0, 0, TileKind.Bell);
    world.place(3, 3, TileKind.Resonator);
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 6; tick += 1) {
      simulation.step();
      expect(world.chargeAt(3, 3)).toBe(0);
    }
    expect(world.kindAt(0, 3)).toBe(TileKind.Bell);
  });

  it("preserves a heard pulse through save/load, independent clone, reset, and transform", () => {
    const world = new World(9, 5);
    addBell(world);
    addReceiver(world);
    const simulation = new Simulation(world);
    const baseline = world.clone();
    simulation.step();
    world.place(1, 0, TileKind.Empty);
    world.place(2, 0, TileKind.Empty);
    const heard = world.clone();
    const loaded = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    for (const copy of [heard.clone(), loaded]) {
      const playback = new Simulation(copy);
      playback.step();
      expect(copy.chargeAt(1, 4)).toBe(1);
      playback.step();
      expect(copy.chargeAt(1, 4)).toBe(0);
    }
    const transformed = heard.transformed(1, true, false);
    new Simulation(transformed).step();
    expect(transformed.chargeAt(0, 7)).toBe(1);
    simulation.resetTo(heard);
    simulation.step();
    expect(world.chargeAt(1, 4)).toBe(1);
    simulation.resetTo(baseline);
    simulation.step();
    expect(world.chargeAt(1, 4)).toBe(0);
  });

  it("keeps hearing local to each nested board, not the moving array carrier", () => {
    const world = new World(9, 5);
    addBell(world);
    addReceiver(world);
    world.place(4, 0, TileKind.RuneArray);
    world.place(5, 0, TileKind.Thruster, Direction.Right);
    world.setWeld(4, 0, 5, 0, true);
    const inner = world.runeArrayWorldAt(4, 0);
    addReceiver(inner);
    inner.place(4, 4, TileKind.Bell);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    expect(world.chargeAt(1, 4)).toBe(1);
    expect(inner.chargeAt(1, 4)).toBe(0);
    world.place(2, 0, TileKind.Empty);
    world.place(3, 0, TileKind.Empty);
    addBell(inner);
    simulation.step();
    simulation.step();
    expect(inner.chargeAt(1, 4)).toBe(1);
    expect(world.chargeAt(1, 4)).toBe(0);
  });

  it("counts mechanically linked remote members for bell and receiver pitch", () => {
    const world = new World(12, 5);
    addBell(world);
    world.place(2, 0, TileKind.MagicLink, Direction.Right);
    world.setWeld(1, 0, 2, 0, true);
    world.place(5, 0, TileKind.MagicLink, Direction.Left);
    addReceiver(world);
    world.place(2, 4, TileKind.MagicLink, Direction.Right);
    world.setWeld(1, 4, 2, 4, true);
    world.place(5, 4, TileKind.MagicLink, Direction.Left);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    expect(world.chargeAt(1, 4)).toBe(1);
  });

  it("matches the lowest pitch across bodies larger than 37 tiles", () => {
    const world = new World(42, 3);
    for (let x = 0; x < 37; x += 1) {
      world.place(x, 0, x === 0 ? TileKind.Bell : x === 1 ? TileKind.Thruster : TileKind.Stone,
        Direction.Right);
      if (x > 0) world.setWeld(x - 1, 0, x, 0, true);
    }
    for (let x = 0; x < 38; x += 1) {
      world.place(x, 2, x === 0 ? TileKind.Resonator : TileKind.Conduit);
      if (x > 0) world.setWeld(x - 1, 2, x, 2, true);
    }
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    expect(world.chargeAt(37, 2)).toBe(1);
  });

  it("uses final topology, including a receiver introduced after observation", () => {
    const world = new World(8, 3);
    world.place(1, 0, TileKind.Bell);
    world.place(2, 0, TileKind.Stone);
    const runtime = new WorldRuntime(world);
    runtime.collectIntents();
    translate(world, 1);
    world.setWeld(2, 0, 3, 0, true);
    addReceiver(world);
    runtime.commitPhases(0, undefined);
    new Simulation(world).step();
    expect(world.chargeAt(1, 2)).toBe(1);
  });

  it("ignores return-to-start movement and replacement bells despite reused cells", () => {
    const world = new World(8, 3);
    world.place(1, 0, TileKind.Bell);
    world.place(6, 2, TileKind.Resonator);
    const runtime = new WorldRuntime(world);
    runtime.collectIntents();
    translate(world, 1);
    translate(world, -1);
    runtime.commitPhases(0, undefined);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.chargeAt(6, 2)).toBe(0);
    runtime.collectIntents();
    world.place(1, 2, TileKind.Empty);
    world.place(1, 2, TileKind.Bell);
    translate(world, 1);
    runtime.commitPhases(1, undefined);
    simulation.step();
    expect(world.chargeAt(7, 2)).toBe(0);
  });

  it("does not replay pending events inside a newly duplicated array", () => {
    const world = new World(5, 3);
    world.place(1, 1, TileKind.RuneArray);
    world.place(2, 1, TileKind.Duplicator, Direction.Right);
    world.place(2, 2, TileKind.Platform);
    world.place(1, 2, TileKind.Platform);
    world.place(3, 2, TileKind.Platform);
    world.setWeld(2, 1, 2, 2, true);
    world.setCharge(2, 1, 1);
    const original = world.runeArrayWorldAt(1, 1);
    addBell(original);
    addReceiver(original);
    const simulation = new Simulation(world);
    simulation.step();
    const produced = world.runeArrayWorldAt(3, 1);
    simulation.step();
    expect(original.chargeAt(1, 4)).toBe(1);
    expect(produced.chargeAt(3, 4)).toBe(0);
    simulation.step();
    expect(produced.chargeAt(3, 4)).toBe(1);
  });
});
