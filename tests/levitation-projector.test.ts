import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, directionX, directionY, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function braceProjector(world: World, x: number, y: number, direction: Direction): void {
  world.place(x, y, TileKind.LevitationProjector, direction);
  world.place(x, y + 1, TileKind.Platform);
  world.setWeld(x, y, x, y + 1, true);
}

describe("levitation projector", () => {
  it.each([Direction.Up, Direction.Right, Direction.Down, Direction.Left])(
    "projects through gaps and multiple bodies only in direction %i after scene round-trip",
    (direction) => {
      const original = new World(9, 9);
      braceProjector(original, 4, 4, direction);
      const dx = directionX(direction);
      const dy = directionY(direction);
      original.place(4 + dx * 2, 4 + dy * 2, TileKind.Stone);
      original.place(4 + dx * 3, 4 + dy * 3, TileKind.Sand);
      original.place(4 - dx * 2, 4 - dy * 2, TileKind.Stone);
      const world = deserializeBoard(serializeBoard(original.clone(), 0)).world;
      new Simulation(world).step();
      expect(world.kindAt(4 + dx * 2, 4 + dy * 2)).toBe(TileKind.Stone);
      expect(world.kindAt(4 + dx * 3, 4 + dy * 3)).toBe(TileKind.Sand);
      expect(world.kindAt(4 - dx * 2, 5 - dy * 2)).toBe(TileKind.Stone);
    },
  );

  it("holds the whole welded body and releases it when the projector is removed", () => {
    const world = new World(7, 6);
    braceProjector(world, 0, 2, Direction.Right);
    const target = world.place(3, 2, TileKind.Stone);
    const load = world.place(3, 3, TileKind.Iron);
    world.setWeld(3, 2, 3, 3, true);
    const outside = world.place(5, 1, TileKind.Stone);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(3, 2)).toBe(target);
    expect(world.idAt(3, 3)).toBe(load);
    expect(world.idAt(5, 2)).toBe(outside);
    simulation.step();
    expect(world.idAt(5, 2)).toBe(outside);
    world.place(0, 2, TileKind.Empty);
    simulation.step();
    expect(world.idAt(3, 3)).toBe(target);
    expect(world.idAt(3, 4)).toBe(load);
    expect(world.isWelded(3, 3, 3, 4)).toBe(true);
    expect(world.idAt(5, 3)).toBe(outside);
  });

  it("allows independent falling weight to push a levitating body out of the beam", () => {
    const world = new World(5, 6);
    braceProjector(world, 0, 2, Direction.Right);
    const weight = world.place(3, 1, TileKind.Stone);
    const target = world.place(3, 2, TileKind.Iron);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(3, 2)).toBe(weight);
    expect(world.idAt(3, 3)).toBe(target);
    simulation.step();
    expect(world.idAt(3, 2)).toBe(weight);
    expect(world.idAt(3, 4)).toBe(target);
  });

  it("lets a conveyor lift a beam target, then restores gravity outside the beam", () => {
    const world = new World(6, 6);
    braceProjector(world, 0, 3, Direction.Right);
    world.place(4, 3, TileKind.Conveyor);
    world.place(4, 4, TileKind.FixedCharge);
    world.place(4, 5, TileKind.Platform);
    world.setWeld(4, 3, 4, 4, true);
    world.setWeld(4, 4, 4, 5, true);
    const target = world.place(3, 3, TileKind.Stone);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(3, 2)).toBe(target);
    simulation.step();
    expect(world.idAt(3, 3)).toBe(target);
  });

  it("recomputes the ray after its unsupported projector falls", () => {
    const world = new World(5, 5);
    const projector = world.place(0, 1, TileKind.LevitationProjector, Direction.Right);
    const target = world.place(3, 1, TileKind.Stone);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(0, 2)).toBe(projector);
    expect(world.idAt(3, 1)).toBe(target);
    simulation.step();
    expect(world.idAt(0, 3)).toBe(projector);
    expect(world.idAt(3, 2)).toBe(target);
  });

  it("does not wrap a horizontal beam onto the next row", () => {
    const world = new World(4, 4);
    braceProjector(world, 3, 0, Direction.Right);
    const target = world.place(0, 1, TileKind.Stone);
    new Simulation(world).step();
    expect(world.idAt(0, 2)).toBe(target);
  });

  it("runs inside arrays without projecting into the enclosing board", () => {
    const world = new World(5, 5);
    world.place(1, 2, TileKind.RuneArray);
    world.place(1, 3, TileKind.Platform);
    world.setWeld(1, 2, 1, 3, true);
    const outside = world.place(3, 2, TileKind.Stone);
    const inner = world.runeArrayWorldAt(1, 2);
    braceProjector(inner, 0, 2, Direction.Right);
    const inside = inner.place(3, 2, TileKind.Stone);
    new Simulation(world).step();
    expect(inner.idAt(3, 2)).toBe(inside);
    expect(world.idAt(3, 3)).toBe(outside);
  });
});
