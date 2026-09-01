import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function placeFloor(world: World, y: number): void {
  for (let x = 0; x < world.width; x += 1) {
    world.place(x, y, TileKind.Platform);
  }
}

describe("delivery boxes", () => {
  it("absorbs a matching front block and pulses its welded side network for one tick", () => {
    const world = new World(4, 3);
    world.place(0, 1, TileKind.Stone);
    world.place(1, 1, TileKind.Delivery, Direction.Right);
    world.place(2, 1, TileKind.Stone);
    world.place(1, 0, TileKind.Conduit);
    world.setWeld(1, 0, 1, 1, true);
    placeFloor(world, 2);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);

    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(0, 1)).toBe(TileKind.Stone);
    expect(world.chargeAt(1, 1)).toBe(1);
    expect(world.chargeAt(1, 0)).toBe(1);

    simulation.step();

    expect(world.chargeAt(1, 1)).toBe(0);
    expect(world.chargeAt(1, 0)).toBe(0);
  });

  it("absorbs a translated matching body when the adjacent tile kinds differ", () => {
    const world = new World(8, 4);
    world.place(1, 1, TileKind.Stone);
    world.place(2, 1, TileKind.Iron);
    world.setWeld(1, 1, 2, 1, true);
    world.place(3, 1, TileKind.Delivery, Direction.Right);
    const targetStoneId = world.place(4, 1, TileKind.Stone);
    const targetIronId = world.place(5, 1, TileKind.Iron);
    world.setWeld(4, 1, 5, 1, true);
    placeFloor(world, 2);

    new Simulation(world).step();

    expect(world.idAt(1, 1)).not.toBe(0);
    expect(world.idAt(2, 1)).not.toBe(0);
    expect(world.idAt(4, 1)).not.toBe(targetStoneId);
    expect(world.idAt(5, 1)).not.toBe(targetIronId);
    expect(world.kindAt(4, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(5, 1)).toBe(TileKind.Empty);
    expect(world.chargeAt(3, 1)).toBe(1);
  });

  it("rejects a mirrored body instead of rotating or reflecting the reference", () => {
    const world = new World(8, 4);
    world.place(1, 1, TileKind.Stone);
    world.place(2, 1, TileKind.Iron);
    world.setWeld(1, 1, 2, 1, true);
    world.place(3, 1, TileKind.Delivery, Direction.Right);
    const targetIronId = world.place(4, 1, TileKind.Iron);
    const targetStoneId = world.place(5, 1, TileKind.Stone);
    world.setWeld(4, 1, 5, 1, true);
    placeFloor(world, 2);

    new Simulation(world).step();

    expect(world.idAt(4, 1)).toBe(targetIronId);
    expect(world.idAt(5, 1)).toBe(targetStoneId);
    expect(world.chargeAt(3, 1)).toBe(0);
  });

  it("requires tile orientations to match exactly", () => {
    const world = new World(4, 3);
    world.place(0, 1, TileKind.Sensor, Direction.Right);
    world.place(1, 1, TileKind.Delivery, Direction.Right);
    const targetId = world.place(2, 1, TileKind.Sensor, Direction.Left);
    placeFloor(world, 2);

    new Simulation(world).step();

    expect(world.idAt(2, 1)).toBe(targetId);
    expect(world.chargeAt(1, 1)).toBe(0);
  });

  it("ignores stored orientations for non-directional tile kinds", () => {
    const world = new World(4, 3);
    world.place(0, 1, TileKind.Stone, Direction.Right);
    world.place(1, 1, TileKind.Delivery, Direction.Right);
    const targetId = world.place(2, 1, TileKind.Stone, Direction.Left);
    placeFloor(world, 2);

    expect(world.orientationAt(0, 1)).toBe(Direction.Right);
    expect(world.orientationAt(2, 1)).toBe(Direction.Left);

    new Simulation(world).step();

    expect(world.idAt(2, 1)).not.toBe(targetId);
    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
    expect(world.chargeAt(1, 1)).toBe(1);
  });

  it("requires the internal weld topology to match", () => {
    const world = new World(8, 8);
    world.place(4, 4, TileKind.Delivery, Direction.Up);
    world.place(3, 4, TileKind.Platform);
    for (const y of [2, 3, 5, 6]) {
      for (const x of [3, 4]) {
        world.place(x, y, TileKind.Stone);
      }
    }
    world.setWeld(3, 2, 4, 2, true);
    world.setWeld(3, 2, 3, 3, true);
    world.setWeld(4, 2, 4, 3, true);
    world.setWeld(3, 3, 4, 3, true);
    world.setWeld(3, 5, 4, 5, true);
    world.setWeld(3, 5, 3, 6, true);
    world.setWeld(3, 6, 4, 6, true);
    placeFloor(world, 7);
    const targetId = world.idAt(4, 3);

    new Simulation(world).step();

    expect(world.idAt(4, 3)).toBe(targetId);
    expect(world.chargeAt(4, 4)).toBe(0);
  });

  it("ignores configurable component contents when matching bodies", () => {
    const world = new World(4, 3);
    world.place(0, 1, TileKind.Rom);
    world.configureRom(0, 1, 1, 1, [1]);
    world.place(1, 1, TileKind.Delivery, Direction.Right);
    world.place(2, 1, TileKind.Rom);
    world.configureRom(2, 1, 1, 1, [-1]);
    placeFloor(world, 2);

    new Simulation(world).step();

    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
    expect(world.chargeAt(1, 1)).toBe(1);
  });

  it("does not absorb a front block of a different kind", () => {
    const world = new World(4, 3);
    world.place(0, 1, TileKind.Stone);
    world.place(1, 1, TileKind.Delivery, Direction.Right);
    const targetId = world.place(2, 1, TileKind.Iron);
    placeFloor(world, 2);

    new Simulation(world).step();

    expect(world.idAt(2, 1)).toBe(targetId);
    expect(world.chargeAt(1, 1)).toBe(0);
  });

  it("jams boxes targeting different members of the same welded body", () => {
    const world = new World(8, 4);
    world.place(0, 1, TileKind.Stone);
    world.place(1, 1, TileKind.Iron);
    world.setWeld(0, 1, 1, 1, true);
    world.place(2, 1, TileKind.Delivery, Direction.Right);
    const targetStoneId = world.place(3, 1, TileKind.Stone);
    const targetIronId = world.place(4, 1, TileKind.Iron);
    world.setWeld(3, 1, 4, 1, true);
    world.place(5, 1, TileKind.Delivery, Direction.Left);
    world.place(6, 1, TileKind.Stone);
    world.place(7, 1, TileKind.Iron);
    world.setWeld(6, 1, 7, 1, true);
    placeFloor(world, 2);

    new Simulation(world).step();

    expect(world.idAt(3, 1)).toBe(targetStoneId);
    expect(world.idAt(4, 1)).toBe(targetIronId);
    expect(world.chargeAt(2, 1)).toBe(0);
    expect(world.chargeAt(5, 1)).toBe(0);
  });

  it("round-trips its orientation and active pulse through board JSON", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Delivery, Direction.Left);
    world.setCharge(0, 0, 1);

    const imported = deserializeBoard(serializeBoard(world, 7));

    expect(imported.tick).toBe(7);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.Delivery);
    expect(imported.world.orientationAt(0, 0)).toBe(Direction.Left);
    expect(imported.world.chargeAt(0, 0)).toBe(1);
  });
});
