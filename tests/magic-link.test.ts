import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function braceLink(world: World, x: number, y: number, direction: Direction): void {
  world.place(x, y, TileKind.MagicLink, direction);
  world.place(x, y - 1, TileKind.Platform);
  world.setWeld(x, y, x, y - 1, true);
}

function placeObservedBody(world: World, x: number): void {
  world.place(x, 0, TileKind.Conduit);
  world.place(x, 1, TileKind.MagicLink, Direction.Down);
  world.setWeld(x, 0, x, 1, true);
  world.place(x, 2, TileKind.Platform);
  world.place(x, 4, TileKind.MagicLink, Direction.Up);
  world.place(x, 5, TileKind.Conduit);
  world.setWeld(x, 4, x, 5, true);
  world.place(x, 6, TileKind.Platform);
}

function matchingObservedBodies(kind: TileKind.Comparer | TileKind.Delivery): World {
  const world = new World(7, 7);
  placeObservedBody(world, 2);
  placeObservedBody(world, 4);
  world.place(3, 1, kind, Direction.Right);
  world.place(3, 2, TileKind.Platform);
  return world;
}

function placePoweredPiston(world: World): void {
  world.place(1, 2, TileKind.Piston, Direction.Right);
  world.place(1, 3, TileKind.FixedCharge);
  world.place(1, 4, TileKind.Platform);
  world.setWeld(1, 2, 1, 3, true);
  world.setWeld(1, 3, 1, 4, true);
}

function placePistonLoad(world: World): void {
  world.place(2, 2, TileKind.MagicLink, Direction.Right);
  world.setWeld(1, 2, 2, 2, true);
  world.place(6, 2, TileKind.MagicLink, Direction.Left);
  world.place(6, 3, TileKind.Stone);
  world.setWeld(6, 2, 6, 3, true);
}

describe("magic links", () => {
  it("anchors a remote welded load through obstructions without supporting the ray's gaps", () => {
    const world = new World(9, 7);
    braceLink(world, 0, 2, Direction.Right);
    const near = world.idAt(0, 2);
    const remote = world.place(7, 2, TileKind.MagicLink, Direction.Left);
    const load = world.place(7, 3, TileKind.Iron);
    world.setWeld(7, 2, 7, 3, true);
    world.place(2, 2, TileKind.Platform);
    const obstruction = world.place(3, 2, TileKind.Stone);
    const perpendicular = world.place(4, 2, TileKind.MagicLink, Direction.Up);
    const falling = world.place(5, 1, TileKind.Stone);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(7, 2)).toBe(remote);
    expect(world.idAt(7, 3)).toBe(load);
    expect(world.idAt(3, 3)).toBe(obstruction);
    expect(world.idAt(4, 3)).toBe(perpendicular);
    expect(world.idAt(5, 2)).toBe(falling);
    simulation.step();
    expect(world.idAt(5, 3)).toBe(falling);

    world.setWeld(0, 1, 0, 2, false);
    simulation.step();
    expect(world.idAt(0, 3)).toBe(near);
    expect(world.idAt(7, 3)).toBe(remote);
    expect(world.idAt(7, 4)).toBe(load);
    expect(world.isWelded(7, 3, 7, 4)).toBe(true);
  });

  it("merges multiple incoming links and a transitive link on another axis", () => {
    const world = new World(9, 9);
    braceLink(world, 0, 2, Direction.Right);
    const incoming = world.place(3, 2, TileKind.MagicLink, Direction.Right);
    const junction = world.place(6, 2, TileKind.MagicLink, Direction.Left);
    const downward = world.place(6, 3, TileKind.MagicLink, Direction.Down);
    world.setWeld(6, 2, 6, 3, true);
    const remote = world.place(6, 6, TileKind.MagicLink, Direction.Up);
    const load = world.place(7, 6, TileKind.Stone);
    world.setWeld(6, 6, 7, 6, true);

    new Simulation(world).step();

    // The anchor targets the junction, but the junction targets the nearer incoming link.
    expect(world.idAt(3, 2)).toBe(incoming);
    expect(world.idAt(6, 2)).toBe(junction);
    expect(world.idAt(6, 3)).toBe(downward);
    expect(world.idAt(6, 6)).toBe(remote);
    expect(world.idAt(7, 6)).toBe(load);
  });

  it("stops at a disabled opposing link instead of joining a farther facing pair", () => {
    const world = new World(11, 6);
    braceLink(world, 0, 2, Direction.Right);
    const disabled = world.place(3, 2, TileKind.MagicLink, Direction.Left);
    world.place(4, 2, TileKind.Conduit);
    world.setWeld(3, 2, 4, 2, true);
    world.setCharge(4, 2, -1);
    const fartherRight = world.place(6, 2, TileKind.MagicLink, Direction.Right);
    const fartherLeft = world.place(9, 2, TileKind.MagicLink, Direction.Left);

    new Simulation(world).step();

    expect(world.kindAt(0, 2)).toBe(TileKind.MagicLink);
    expect(world.idAt(3, 3)).toBe(disabled);
    expect(world.idAt(6, 3)).toBe(fartherRight);
    expect(world.idAt(9, 3)).toBe(fartherLeft);
  });

  it("does not carry electrical charge or treat a side input as the rear control", () => {
    const world = new World(8, 6);
    braceLink(world, 1, 2, Direction.Right);
    world.place(0, 2, TileKind.FixedCharge);
    world.setWeld(0, 2, 1, 2, true);
    const remote = world.place(5, 2, TileKind.MagicLink, Direction.Left);
    world.place(6, 2, TileKind.Conduit);
    world.setWeld(5, 2, 6, 2, true);
    world.place(5, 3, TileKind.Conduit);
    world.setWeld(5, 2, 5, 3, true);
    world.setCharge(5, 3, -1);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(5, 2)).toBe(remote);
    expect(world.chargeAt(0, 2)).toBe(1);
    expect(world.chargeAt(6, 2)).toBe(0);
    simulation.step();
    expect(world.idAt(5, 2)).toBe(remote);
    expect(world.chargeAt(6, 2)).toBe(0);
  });

  it.each([0, 5])(
    "observes previous-tick rear -1 at either endpoint (input row %i) and re-enables without a geometry change",
    (inputY) => {
      const world = matchingObservedBodies(TileKind.Comparer);
      const simulation = new Simulation(world);
      simulation.step();
      expect(world.chargeAt(3, 1)).toBe(1);

      // Both halves have independent support, so toggling the input cannot move them.
      world.setCharge(4, inputY, -1);
      simulation.step();
      expect(world.chargeAt(4, inputY)).toBe(0);
      expect(world.chargeAt(3, 1)).toBe(0);
      simulation.step();
      expect(world.chargeAt(3, 1)).toBe(1);
      world.setCharge(4, inputY, 1);
      simulation.step();
      expect(world.chargeAt(3, 1)).toBe(1);
      expect(world.kindAt(4, 1)).toBe(TileKind.MagicLink);
      expect(world.kindAt(4, 4)).toBe(TileKind.MagicLink);
    },
  );

  it("compares remote members instead of only the adjacent welded fragment", () => {
    const world = matchingObservedBodies(TileKind.Comparer);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.chargeAt(3, 1)).toBe(1);

    world.place(4, 5, TileKind.Stone);
    world.setWeld(4, 4, 4, 5, true);
    simulation.step();

    expect(world.chargeAt(3, 1)).toBe(0);
    expect(world.kindAt(2, 5)).toBe(TileKind.Conduit);
    expect(world.kindAt(4, 5)).toBe(TileKind.Stone);
  });

  it("delivers every remote member of a matching body and leaves the reference and gap terrain intact", () => {
    const world = matchingObservedBodies(TileKind.Delivery);
    const reference = [0, 1, 4, 5].map((y) => world.idAt(2, y));

    new Simulation(world).step();

    expect(world.chargeAt(3, 1)).toBe(1);
    expect([0, 1, 4, 5].map((y) => world.kindAt(4, y)))
      .toEqual([TileKind.Empty, TileKind.Empty, TileKind.Empty, TileKind.Empty]);
    expect([0, 1, 4, 5].map((y) => world.idAt(2, y))).toEqual(reference);
    expect(world.kindAt(4, 2)).toBe(TileKind.Platform);
    expect(world.kindAt(4, 6)).toBe(TileKind.Platform);
  });

  it("duplicates the complete remote body without copying intervening terrain", () => {
    const world = new World(7, 7);
    placeObservedBody(world, 2);
    world.place(3, 1, TileKind.Duplicator, Direction.Right);
    world.setCharge(3, 1, 1);
    world.place(3, 2, TileKind.Platform);
    world.place(4, 2, TileKind.Platform);
    world.place(4, 6, TileKind.Platform);
    const source = [0, 1, 4, 5].map((y) => world.idAt(2, y));

    new Simulation(world).step();

    expect([0, 1, 4, 5].map((y) => world.kindAt(4, y)))
      .toEqual([TileKind.Conduit, TileKind.MagicLink, TileKind.MagicLink, TileKind.Conduit]);
    expect([0, 1, 4, 5].map((y) => world.idAt(2, y))).toEqual(source);
    for (const y of [0, 1, 4, 5]) {
      expect(source).not.toContain(world.idAt(4, y));
    }
    expect(world.orientationAt(4, 1)).toBe(Direction.Down);
    expect(world.orientationAt(4, 4)).toBe(Direction.Up);
    expect(world.isWelded(4, 0, 4, 1)).toBe(true);
    expect(world.isWelded(4, 4, 4, 5)).toBe(true);
    expect(world.kindAt(4, 3)).toBe(TileKind.Empty);
  });

  it("pushes and retracts a head-welded body including its remote load", () => {
    const world = new World(9, 6);
    placePoweredPiston(world);
    placePistonLoad(world);
    const near = world.idAt(2, 2);
    const remote = world.idAt(6, 2);
    const load = world.idAt(6, 3);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(3, 2)).toBe(near);
    expect(world.idAt(7, 2)).toBe(remote);
    expect(world.idAt(7, 3)).toBe(load);
    expect(world.isWelded(2, 2, 3, 2)).toBe(true);

    world.place(1, 3, TileKind.Inverter, Direction.Up);
    world.setWeld(1, 2, 1, 3, true);
    world.setWeld(1, 3, 1, 4, true);
    world.place(0, 3, TileKind.FixedCharge);
    world.setWeld(0, 3, 1, 3, true);
    simulation.step();
    simulation.step();

    expect(world.kindAt(1, 2)).toBe(TileKind.Piston);
    expect(world.idAt(2, 2)).toBe(near);
    expect(world.idAt(6, 2)).toBe(remote);
    expect(world.idAt(6, 3)).toBe(load);
    expect(world.isWelded(6, 2, 6, 3)).toBe(true);
  });

  it("jams a piston when only the remote load's destination is blocked", () => {
    const world = new World(9, 6);
    placePoweredPiston(world);
    placePistonLoad(world);
    world.place(7, 3, TileKind.Platform);
    const near = world.idAt(2, 2);
    const remote = world.idAt(6, 2);

    new Simulation(world).step();

    expect(world.kindAt(1, 2)).toBe(TileKind.Piston);
    expect(world.idAt(2, 2)).toBe(near);
    expect(world.idAt(6, 2)).toBe(remote);
  });

  it("turns a remote load around the rotator and preserves its link after the turn", () => {
    const world = new World(11, 11);
    world.place(4, 5, TileKind.Rotator, Direction.Up);
    world.place(4, 6, TileKind.FixedCharge);
    world.place(4, 7, TileKind.Platform);
    world.setWeld(4, 5, 4, 6, true);
    world.setWeld(4, 6, 4, 7, true);
    const near = world.place(4, 4, TileKind.MagicLink, Direction.Right);
    world.place(4, 3, TileKind.Floatstone);
    world.setWeld(4, 3, 4, 4, true);
    const remote = world.place(7, 4, TileKind.MagicLink, Direction.Left);
    const load = world.place(7, 3, TileKind.Stone);
    world.setWeld(7, 3, 7, 4, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(5, 5)).toBe(near);
    expect(world.idAt(5, 8)).toBe(remote);
    expect(world.idAt(6, 8)).toBe(load);
    expect(world.orientationAt(5, 5)).toBe(Direction.Down);
    expect(world.orientationAt(5, 8)).toBe(Direction.Up);
    expect(world.isWelded(5, 8, 6, 8)).toBe(true);
    simulation.step();
    expect(world.idAt(5, 8)).toBe(remote);
    expect(world.idAt(6, 8)).toBe(load);
  });

  it("reads a previous-tick rear disable through two enclosing virtual array ports", () => {
    const world = new World(4, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.setCharge(0, 0, 1);
    world.place(1, 0, TileKind.Inverter, Direction.Right);
    world.place(2, 0, TileKind.RuneArray);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 2, 0, true);
    world.configureRuneArray(2, 0, 3, 1, "");
    const inner = world.runeArrayWorldAt(2, 0);
    inner.place(0, 0, TileKind.Conduit);
    inner.place(1, 0, TileKind.RuneArray);
    inner.setWeld(0, 0, 1, 0, true);
    const deepest = inner.runeArrayWorldAt(1, 0);
    braceLink(deepest, 0, 2, Direction.Right);
    const remote = deepest.place(3, 2, TileKind.MagicLink, Direction.Left);
    const simulation = new Simulation(world);

    simulation.step();
    expect(deepest.idAt(3, 2)).toBe(remote);
    simulation.step();
    expect(deepest.idAt(3, 3)).toBe(remote);
  });

  it("rebuilds facing links after cloning, reflection, rotation, and a scene round-trip", () => {
    const original = new World(7, 7);
    braceLink(original, 1, 2, Direction.Right);
    original.place(5, 2, TileKind.MagicLink, Direction.Left);
    original.place(5, 3, TileKind.Stone);
    original.setWeld(5, 2, 5, 3, true);
    original.place(3, 2, TileKind.Iron);
    const transformed = original.clone().transformed(1, true, false);
    const world = deserializeBoard(serializeBoard(transformed, 0)).world;

    new Simulation(world).step();

    expect(world.kindAt(4, 5)).toBe(TileKind.MagicLink);
    expect(world.kindAt(4, 1)).toBe(TileKind.MagicLink);
    expect(world.kindAt(3, 1)).toBe(TileKind.Stone);
    expect(world.isWelded(4, 1, 3, 1)).toBe(true);
    expect(world.kindAt(4, 4)).toBe(TileKind.Iron);
  });

  it("does not wrap a ray across a row boundary", () => {
    const world = new World(5, 5);
    braceLink(world, 4, 1, Direction.Right);
    const remote = world.place(0, 2, TileKind.MagicLink, Direction.Left);

    new Simulation(world).step();

    expect(world.idAt(0, 3)).toBe(remote);
  });
});
