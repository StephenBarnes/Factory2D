import { describe, expect, it } from "vitest";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import {
  Direction,
  TILE_DEFINITIONS,
  TileKind,
  WeldSide,
} from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function placePoweredDuplicator(
  world: World,
  inputSide: Direction.Left | Direction.Right,
): void {
  world.place(4, 4, TileKind.Duplicator, Direction.Up);
  const sideX = inputSide === Direction.Left ? 3 : 5;
  const chargeX = inputSide === Direction.Left ? 2 : 6;
  const anchorX = inputSide === Direction.Left ? 1 : 7;
  world.place(sideX, 4, TileKind.Conduit);
  world.place(chargeX, 4, TileKind.FixedCharge);
  world.place(anchorX, 4, TileKind.Platform);
  world.setWeld(4, 4, sideX, 4, true);
  world.setWeld(sideX, 4, chargeX, 4, true);
  world.setWeld(chargeX, 4, anchorX, 4, true);
}

describe("duplicators", () => {
  it.each([Direction.Left, Direction.Right] as const)(
    "copies a welded body when its %s side network receives +1",
    (inputSide) => {
      const world = new World(9, 7);
      placePoweredDuplicator(world, inputSide);
      world.place(4, 5, TileKind.Rom, Direction.Up);
      const anchorX = inputSide === Direction.Left ? 5 : 3;
      world.place(anchorX, 5, TileKind.Platform);
      world.setWeld(4, 5, anchorX, 5, true);
      world.configureTernaryGrid(4, 5, 2, 2, [-1, 0, 1, -1]);
      world.advanceRomAtIndex(5 * world.width + 4, 1, 0);
      const sourceState = world.componentStateSnapshotAt(4, 5);
      const sourceId = world.idAt(4, 5);
      const simulation = new Simulation(world);

      simulation.step();
      expect(world.kindAt(4, 3)).toBe(TileKind.Empty);
      simulation.step();

      expect(world.kindAt(4, 3)).toBe(TileKind.Rom);
      expect(world.orientationAt(4, 3)).toBe(Direction.Down);
      expect(world.idAt(4, 3)).not.toBe(sourceId);
      expect(world.componentStateSnapshotAt(4, 3)).toEqual({
        type: "rom", width: 2, height: 2, cursor: 3,
        values: [1, -1, -1, 0],
      });
      expect(world.componentStateSnapshotAt(4, 5)).toEqual(sourceState);
      expect(world.kindAt(anchorX, 3)).toBe(TileKind.Platform);
      expect(world.orientationAt(anchorX, 3)).toBe(Direction.Up);
      expect(world.isWelded(4, 3, anchorX, 3)).toBe(true);
    },
  );

  it("vertically mirrors a 2x2 welded iron body without intersecting the duplicator", () => {
    const world = new World(8, 8);
    world.place(3, 3, TileKind.Duplicator, Direction.Down);
    world.setCharge(3, 3, 1);
    world.place(2, 3, TileKind.Platform);
    world.setWeld(2, 3, 3, 3, true);
    const upperLeftId = world.place(3, 1, TileKind.Iron);
    world.place(4, 1, TileKind.Iron);
    world.place(3, 2, TileKind.Iron);
    world.place(4, 2, TileKind.Iron);
    world.place(5, 1, TileKind.Platform);
    world.setWeld(3, 1, 4, 1, true);
    world.setWeld(3, 1, 3, 2, true);
    world.setWeld(4, 1, 4, 2, true);
    world.setWeld(3, 2, 4, 2, true);
    world.setWeld(4, 1, 5, 1, true);

    new Simulation(world).step();

    expect(world.kindAt(3, 4)).toBe(TileKind.Iron);
    expect(world.kindAt(4, 4)).toBe(TileKind.Iron);
    expect(world.kindAt(3, 5)).toBe(TileKind.Iron);
    expect(world.kindAt(4, 5)).toBe(TileKind.Iron);
    expect(world.kindAt(5, 5)).toBe(TileKind.Platform);
    expect(world.idAt(3, 5)).not.toBe(upperLeftId);
    expect(world.isWelded(3, 4, 4, 4)).toBe(true);
    expect(world.isWelded(3, 4, 3, 5)).toBe(true);
    expect(world.isWelded(4, 4, 4, 5)).toBe(true);
    expect(world.isWelded(3, 5, 4, 5)).toBe(true);
    expect(world.isWelded(4, 5, 5, 5)).toBe(true);
  });

  it("retains a falling duplicate's creation cell for interpolation", () => {
    const world = new World(3, 5);
    world.place(1, 1, TileKind.Duplicator, Direction.Down);
    world.setCharge(1, 1, 1);
    world.place(0, 1, TileKind.Platform);
    world.setWeld(0, 1, 1, 1, true);
    world.place(1, 0, TileKind.Stone);
    const interpolationSource = world.clone();

    new Simulation(world).step(interpolationSource);

    const duplicateId = world.idAt(1, 3);
    expect(duplicateId).not.toBe(0);
    expect(world.kindAt(1, 2)).toBe(TileKind.Empty);
    expect(interpolationSource.idAt(1, 2)).toBe(duplicateId);
    expect(interpolationSource.kindAt(1, 3)).toBe(TileKind.Empty);
  });

  it("horizontally mirrors geometry, orientation, and welds", () => {
    const world = new World(7, 5);
    world.place(3, 2, TileKind.Duplicator, Direction.Right);
    world.setCharge(3, 2, 1);
    world.place(3, 1, TileKind.Platform);
    world.setWeld(3, 1, 3, 2, true);
    world.place(2, 2, TileKind.Sensor, Direction.Left);
    world.place(2, 3, TileKind.Platform);
    world.setWeld(2, 2, 2, 3, true);

    new Simulation(world).step();

    expect(world.kindAt(4, 2)).toBe(TileKind.Sensor);
    expect(world.orientationAt(4, 2)).toBe(Direction.Right);
    expect(world.kindAt(4, 3)).toBe(TileKind.Platform);
    expect(world.isWelded(4, 2, 4, 3)).toBe(true);
  });

  it("copies only the source welded body and requires every destination cell to be empty", () => {
    const world = new World(7, 6);
    world.place(3, 3, TileKind.Duplicator, Direction.Up);
    world.setCharge(3, 3, 1);
    world.place(3, 4, TileKind.Stone);
    world.place(4, 4, TileKind.Platform);
    world.setWeld(3, 4, 4, 4, true);
    world.place(2, 4, TileKind.Iron);
    const blockerId = world.place(4, 2, TileKind.Platform);

    new Simulation(world).step();

    expect(world.kindAt(3, 2)).toBe(TileKind.Empty);
    expect(world.idAt(4, 2)).toBe(blockerId);
    expect(world.kindAt(2, 2)).toBe(TileKind.Empty);
  });

  it("does not partially copy a mirrored body that would cross the world boundary", () => {
    const world = new World(4, 4);
    world.place(1, 1, TileKind.Duplicator, Direction.Up);
    world.setCharge(1, 1, 1);
    world.place(0, 1, TileKind.Platform);
    world.setWeld(0, 1, 1, 1, true);
    world.place(1, 2, TileKind.Platform);
    world.place(1, 3, TileKind.Platform);
    world.setWeld(1, 2, 1, 3, true);

    new Simulation(world).step();

    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
  });

  it("does not trigger on negative charge", () => {
    const world = new World(5, 5);
    world.place(2, 2, TileKind.Duplicator, Direction.Up);
    world.setCharge(2, 2, -1);
    world.place(2, 3, TileKind.Platform);

    new Simulation(world).step();

    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
  });

  it("jams duplicators whose output bodies overlap", () => {
    const world = new World(7, 3);
    world.place(2, 1, TileKind.Duplicator, Direction.Right);
    world.place(4, 1, TileKind.Duplicator, Direction.Left);
    world.setCharge(2, 1, 1);
    world.setCharge(4, 1, 1);
    world.place(1, 1, TileKind.Platform);
    world.place(5, 1, TileKind.Platform);
    world.place(2, 2, TileKind.Platform);
    world.place(4, 2, TileKind.Platform);
    world.setWeld(2, 1, 2, 2, true);
    world.setWeld(4, 1, 4, 2, true);

    new Simulation(world).step();

    expect(world.kindAt(3, 1)).toBe(TileKind.Empty);
  });

  it("defines directional ports and round-trips through the board format", () => {
    const definition = TILE_DEFINITIONS[TileKind.Duplicator];
    expect(definition.usesOrientation).toBe(true);
    expect(definition.circuitPorts).toBe(WeldSide.Right | WeldSide.Left);

    const world = new World(1, 1);
    world.place(0, 0, TileKind.Duplicator, Direction.Left);
    const imported = deserializeBoard(serializeBoard(world, 3));

    expect(JSON.parse(serializeBoard(world, 3)).grid).toEqual(["Y"]);
    expect(imported.tick).toBe(3);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.Duplicator);
    expect(imported.world.orientationAt(0, 0)).toBe(Direction.Left);
  });
});
