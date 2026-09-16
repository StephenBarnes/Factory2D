import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, directionX, directionY, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("thrusters", () => {
  it.each([Direction.Up, Direction.Right, Direction.Down, Direction.Left])(
    "propels a lone thruster without gravity or circuitry in direction %s, stopping at the boundary",
    (direction) => {
      const world = new World(5, 5);
      const id = world.place(2, 2, TileKind.Thruster, direction);
      const simulation = new Simulation(world);
      const dx = directionX(direction);
      const dy = directionY(direction);
      simulation.step();
      expect(world.idAt(2 + dx, 2 + dy)).toBe(id);
      simulation.step();
      simulation.step();
      expect(world.idAt(2 + 2 * dx, 2 + 2 * dy)).toBe(id);
    },
  );

  it("carries a welded load upward after cloning and scene round-trip", () => {
    const original = new World(5, 5);
    original.place(2, 3, TileKind.Thruster, Direction.Up);
    original.place(3, 3, TileKind.Stone);
    original.setWeld(2, 3, 3, 3, true);
    const world = deserializeBoard(serializeBoard(original.clone(), 0)).world;
    new Simulation(world).step();
    expect(world.kindAt(2, 2)).toBe(TileKind.Thruster);
    expect(world.kindAt(3, 2)).toBe(TileKind.Stone);
    expect(world.isWelded(2, 2, 3, 2)).toBe(true);
    expect(world.kindAt(2, 3)).toBe(TileKind.Empty);
    expect(world.kindAt(3, 3)).toBe(TileKind.Empty);
  });

  it("jams an entire push chain against fixed terrain, then advances when cleared", () => {
    const world = new World(7, 3);
    const thruster = world.place(1, 2, TileKind.Thruster, Direction.Right);
    const first = world.place(2, 2, TileKind.Stone);
    const second = world.place(3, 2, TileKind.Stone);
    world.place(4, 2, TileKind.Platform);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(1, 2)).toBe(thruster);
    expect(world.idAt(2, 2)).toBe(first);
    expect(world.idAt(3, 2)).toBe(second);
    world.place(4, 2, TileKind.Empty);
    simulation.step();
    expect(world.idAt(2, 2)).toBe(thruster);
    expect(world.idAt(3, 2)).toBe(first);
    expect(world.idAt(4, 2)).toBe(second);
  });

  it("cancels opposed welded thrusters, then drives the body when one turns", () => {
    const world = new World(6, 5);
    const left = world.place(2, 2, TileKind.Thruster, Direction.Left);
    const right = world.place(3, 2, TileKind.Thruster, Direction.Right);
    world.setWeld(2, 2, 3, 2, true);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(2, 2)).toBe(left);
    expect(world.idAt(3, 2)).toBe(right);
    world.place(2, 2, TileKind.Thruster, Direction.Right);
    simulation.step();
    expect(world.idAt(3, 2)).toBe(left);
    expect(world.idAt(4, 2)).toBe(right);
    expect(world.isWelded(3, 2, 4, 2)).toBe(true);
  });

  it("jams all thrusters claiming the same empty destination", () => {
    const world = new World(5, 5);
    const left = world.place(1, 2, TileKind.Thruster, Direction.Right);
    const right = world.place(3, 2, TileKind.Thruster, Direction.Left);
    const lower = world.place(2, 3, TileKind.Thruster, Direction.Up);
    new Simulation(world).step();
    expect(world.idAt(1, 2)).toBe(left);
    expect(world.idAt(3, 2)).toBe(right);
    expect(world.idAt(2, 3)).toBe(lower);
    expect(world.kindAt(2, 2)).toBe(TileKind.Empty);
  });

  it("obeys a pushed slider's axis and retries after the rail turns", () => {
    const world = new World(5, 3);
    const thruster = world.place(1, 2, TileKind.Thruster, Direction.Right);
    const slider = world.place(2, 2, TileKind.Slider, Direction.Up);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(1, 2)).toBe(thruster);
    expect(world.idAt(2, 2)).toBe(slider);
    world.place(2, 2, TileKind.Slider, Direction.Right);
    simulation.step();
    expect(world.idAt(2, 2)).toBe(thruster);
    expect(world.idAt(3, 2)).toBe(slider);
  });

  it("reserves its destination before a falling body", () => {
    const world = new World(5, 5);
    const thruster = world.place(1, 2, TileKind.Thruster, Direction.Right);
    const falling = world.place(2, 1, TileKind.Stone);
    new Simulation(world).step();
    expect(world.idAt(2, 2)).toBe(thruster);
    expect(world.idAt(2, 1)).toBe(falling);
  });

  it("lifts an unwelded stack continuously and holds it against the ceiling", () => {
    const world = new World(5, 7);
    const thruster = world.place(2, 5, TileKind.Thruster, Direction.Up);
    const lower = world.place(2, 4, TileKind.Stone);
    const upper = world.place(2, 3, TileKind.Stone);
    const simulation = new Simulation(world);
    for (let tick = 1; tick <= 5; tick += 1) {
      simulation.step();
      const distance = Math.min(tick, 3);
      expect(world.idAt(2, 5 - distance)).toBe(thruster);
      expect(world.idAt(2, 4 - distance)).toBe(lower);
      expect(world.idAt(2, 3 - distance)).toBe(upper);
    }
  });
});

describe("controlled thrusters", () => {
  it.each([Direction.Up, Direction.Right, Direction.Down, Direction.Left])(
    "reads the old charge and carries its source toward input side %s",
    (direction) => {
      const world = new World(7, 7);
      const dx = directionX(direction);
      const dy = directionY(direction);
      const thruster = world.place(3, 3, TileKind.ControlledThruster);
      const source = world.place(3 + dx, 3 + dy, TileKind.FixedCharge);
      world.setWeld(3, 3, 3 + dx, 3 + dy, true);
      const simulation = new Simulation(world);

      simulation.step();
      expect(world.idAt(3, 3)).toBe(thruster);
      simulation.step();
      expect(world.idAt(3 + dx, 3 + dy)).toBe(thruster);
      expect(world.idAt(3 + 2 * dx, 3 + 2 * dy)).toBe(source);
      expect(world.isWelded(3 + dx, 3 + dy, 3 + 2 * dx, 3 + 2 * dy)).toBe(true);
    },
  );

  it("ignores negative and unwelded positive inputs without leaking charge between sides", () => {
    const world = new World(7, 5);
    const thruster = world.place(3, 2, TileKind.ControlledThruster);
    world.place(2, 2, TileKind.Conduit);
    world.setWeld(2, 2, 3, 2, true);
    world.setCharge(2, 2, -1);
    world.place(4, 2, TileKind.FixedCharge);
    world.setCharge(4, 2, 1);
    // Keep the disconnected source beside the hovering body.
    world.place(4, 3, TileKind.Platform);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(3, 2)).toBe(thruster);

    world.setWeld(3, 2, 4, 2, true);
    simulation.step();
    expect(world.idAt(4, 2)).toBe(thruster);
    expect(world.chargeAt(3, 2)).toBe(0);
    expect(world.chargeAtPort(4, 2, Direction.Left)).toBe(0);
  });

  it.each([
    [Direction.Up, Direction.Down],
    [Direction.Up, Direction.Right],
    [Direction.Up, Direction.Right, Direction.Down],
  ])("jams conflicting positive inputs %j instead of summing their forces", (...sides) => {
    const world = new World(7, 7);
    const thruster = world.place(3, 3, TileKind.ControlledThruster);
    for (const side of sides) {
      const x = 3 + directionX(side);
      const y = 3 + directionY(side);
      world.place(x, y, TileKind.FixedCharge);
      world.setCharge(x, y, 1);
      world.setWeld(3, 3, x, y, true);
    }
    new Simulation(world).step();
    expect(world.idAt(3, 3)).toBe(thruster);
  });

  it("pushes a contact chain after scene round-trip and stops when the control goes neutral", () => {
    const original = new World(8, 3);
    original.place(1, 2, TileKind.ControlledThruster);
    original.place(2, 2, TileKind.Conduit);
    original.setWeld(1, 2, 2, 2, true);
    original.setCharge(2, 2, 1);
    original.place(3, 2, TileKind.Stone);
    original.place(4, 2, TileKind.Stone);
    const world = deserializeBoard(serializeBoard(original.clone(), 0)).world;
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.kindAt(2, 2)).toBe(TileKind.ControlledThruster);
    expect(world.kindAt(3, 2)).toBe(TileKind.Conduit);
    expect(world.kindAt(4, 2)).toBe(TileKind.Stone);
    expect(world.kindAt(5, 2)).toBe(TileKind.Stone);
    simulation.step();
    expect(world.kindAt(2, 2)).toBe(TileKind.ControlledThruster);
    expect(world.kindAt(6, 2)).toBe(TileKind.Empty);
  });

  it("reads a virtual array input and combines its force with an ordinary thruster", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.RuneArray);
    world.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);
    simulation.step();
    const inner = world.runeArrayWorldAt(1, 0);
    const controlled = inner.place(0, 2, TileKind.ControlledThruster);
    const constant = inner.place(1, 2, TileKind.Thruster, Direction.Right);
    inner.setWeld(0, 2, 1, 2, true);
    simulation.step();
    expect(inner.idAt(0, 2)).toBe(controlled);
    expect(inner.idAt(1, 2)).toBe(constant);

    world.place(0, 0, TileKind.Empty);
    simulation.step();
    expect(inner.idAt(0, 2)).toBe(controlled);
    simulation.step();
    expect(inner.idAt(1, 2)).toBe(controlled);
    expect(inner.idAt(2, 2)).toBe(constant);
  });
});
