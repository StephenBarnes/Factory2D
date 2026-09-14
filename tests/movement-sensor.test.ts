import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, directionX, directionY, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function ports(world: World, x: number, y: number): number[] {
  return [Direction.Up, Direction.Right, Direction.Down, Direction.Left]
    .map((side) => world.chargeAtPort(x, y, side));
}

describe("movement sensors", () => {
  it("reports the previous fall and clears after a stationary tick, including reset", () => {
    const world = new World(1, 3);
    world.place(0, 0, TileKind.MovementSensor);
    const baseline = world.clone();
    const simulation = new Simulation(world);
    simulation.step();
    expect(ports(world, 0, 1)).toEqual([0, 0, 0, 0]);
    simulation.step();
    expect(ports(world, 0, 2)).toEqual([-1, 0, 1, 0]);
    simulation.step();
    expect(ports(world, 0, 2)).toEqual([-1, 0, 1, 0]);
    simulation.step();
    expect(ports(world, 0, 2)).toEqual([0, 0, 0, 0]);
    simulation.resetTo(baseline);
    simulation.step();
    expect(ports(world, 0, 1)).toEqual([0, 0, 0, 0]);
  });

  it.each([Direction.Up, Direction.Right, Direction.Down, Direction.Left])(
    "drives isolated welded output networks for thrust in direction %s",
    (direction) => {
      const world = new World(11, 11);
      world.place(5, 5, TileKind.MovementSensor);
      for (let side = Direction.Up; side <= Direction.Left; side += 1) {
        const x = 5 + directionX(side);
        const y = 5 + directionY(side);
        world.place(x, y, TileKind.Conduit);
        world.setWeld(5, 5, x, y, true);
      }
      world.place(5, 7, TileKind.Thruster, direction);
      world.setWeld(5, 6, 5, 7, true);
      const simulation = new Simulation(world);
      simulation.step();
      simulation.step();
      const x = 5 + 2 * directionX(direction);
      const y = 5 + 2 * directionY(direction);
      for (let side = Direction.Up; side <= Direction.Left; side += 1) {
        const expected = side === direction ? 1 : side === ((direction + 2) & 3) ? -1 : 0;
        expect(world.chargeAt(x + directionX(side), y + directionY(side))).toBe(expected);
        expect(world.chargeAtPort(x, y, side)).toBe(expected);
      }
    },
  );

  it("reports both axes of a rotator's net displacement rather than the rotated old signal", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    world.place(3, 4, TileKind.FixedCharge);
    world.place(3, 5, TileKind.Platform);
    world.setWeld(3, 3, 3, 4, true);
    world.setWeld(3, 4, 3, 5, true);
    world.place(4, 4, TileKind.Platform);
    const id = world.place(3, 2, TileKind.MovementSensor);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(4, 3)).toBe(id);
    simulation.step();
    expect(ports(world, 4, 3)).toEqual([-1, 1, 1, -1]);
    simulation.step();
    expect(ports(world, 4, 3)).toEqual([0, 0, 0, 0]);
  });

  it("retains pending motion and live outputs through independent clones and scene loading", () => {
    const world = new World(1, 4);
    world.place(0, 0, TileKind.MovementSensor);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    const clone = world.clone();
    const loaded = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    for (const copy of [clone, loaded]) {
      expect(ports(copy, 0, 2)).toEqual([-1, 0, 1, 0]);
      new Simulation(copy).step();
      expect(ports(copy, 0, 3)).toEqual([-1, 0, 1, 0]);
    }
    expect(world.kindAt(0, 2)).toBe(TileKind.MovementSensor);
    expect(ports(world, 0, 2)).toEqual([-1, 0, 1, 0]);
  });

  it("rotates pending movement and independent outputs with a transformed board", () => {
    const world = new World(3, 3);
    world.place(1, 0, TileKind.MovementSensor);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    const rotated = world.transformed(1, false, false);
    expect(ports(rotated, 0, 1)).toEqual([0, -1, 0, 1]);
    new Simulation(rotated).step();
    expect(ports(rotated, 0, 2)).toEqual([0, -1, 0, 1]);
    const reflected = world.transformed(0, false, true);
    new Simulation(reflected).step();
    expect(ports(reflected, 1, 1)).toEqual([1, 0, -1, 0]);
  });

  it("drives an outer array port from local motion but ignores movement of its container", () => {
    const world = new World(1, 5);
    world.place(0, 0, TileKind.RuneArray);
    world.configureRuneArray(0, 0, 1, 3, "");
    const inner = world.runeArrayWorldAt(0, 0);
    inner.place(0, 1, TileKind.MovementSensor);
    world.place(0, 1, TileKind.Conduit);
    world.setWeld(0, 0, 0, 1, true);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    expect(world.chargeAt(0, 3)).toBe(1);
    expect(ports(inner, 0, 2)).toEqual([-1, 0, 1, 0]);
    simulation.step();
    expect(world.chargeAt(0, 4)).toBe(0);
    expect(ports(inner, 0, 2)).toEqual([0, 0, 0, 0]);
  });

  it("does not replay the template's motion on a newly duplicated sensor", () => {
    const world = new World(5, 5);
    world.place(2, 0, TileKind.MovementSensor);
    const simulation = new Simulation(world);
    simulation.step();
    world.place(2, 2, TileKind.Duplicator, Direction.Down);
    world.setCharge(2, 2, 1);
    world.place(1, 2, TileKind.Platform);
    world.setWeld(1, 2, 2, 2, true);
    world.place(2, 4, TileKind.Platform);
    simulation.step();
    expect(world.kindAt(2, 3)).toBe(TileKind.MovementSensor);
    simulation.step();
    expect(ports(world, 2, 3)).toEqual([0, 0, 0, 0]);
  });
});
