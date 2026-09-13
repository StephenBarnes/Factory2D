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

  it("yields its destination to a falling body instead of redirecting it", () => {
    const world = new World(5, 5);
    const thruster = world.place(1, 2, TileKind.Thruster, Direction.Right);
    const falling = world.place(2, 1, TileKind.Stone);
    new Simulation(world).step();
    expect(world.idAt(1, 2)).toBe(thruster);
    expect(world.idAt(2, 2)).toBe(falling);
  });
});
