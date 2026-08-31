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

  it("jams competing boxes instead of crediting one iteration-order winner", () => {
    const world = new World(5, 4);
    world.place(0, 2, TileKind.Stone);
    world.place(1, 2, TileKind.Delivery, Direction.Right);
    const targetId = world.place(2, 2, TileKind.Stone);
    world.place(3, 2, TileKind.Delivery, Direction.Left);
    world.place(4, 2, TileKind.Stone);
    placeFloor(world, 3);

    new Simulation(world).step();

    expect(world.idAt(2, 2)).toBe(targetId);
    expect(world.chargeAt(1, 2)).toBe(0);
    expect(world.chargeAt(3, 2)).toBe(0);
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
