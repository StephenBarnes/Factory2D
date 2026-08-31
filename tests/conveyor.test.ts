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

const DIRECTION_X: Readonly<Record<Direction, number>> = {
  [Direction.Up]: 0,
  [Direction.Right]: 1,
  [Direction.Down]: 0,
  [Direction.Left]: -1,
};

const DIRECTION_Y: Readonly<Record<Direction, number>> = {
  [Direction.Up]: -1,
  [Direction.Right]: 0,
  [Direction.Down]: 1,
  [Direction.Left]: 0,
};

function rotate(direction: Direction, quarterTurns: number): Direction {
  return ((direction + quarterTurns + 4) & 3) as Direction;
}

function placeFixedPoweredConveyor(
  world: World,
  conveyorX: number,
  conveyorY: number,
  charge: -1 | 0 | 1,
  sourceSide: Direction,
): void {
  const sideX = DIRECTION_X[sourceSide];
  const sideY = DIRECTION_Y[sourceSide];
  const lockSide = rotate(sourceSide, 1);
  const lockX = DIRECTION_X[lockSide];
  const lockY = DIRECTION_Y[lockSide];
  const sensorX = conveyorX + sideX;
  const sensorY = conveyorY + sideY;
  const inputX = conveyorX + sideX * 2;
  const inputY = conveyorY + sideY * 2;

  world.place(conveyorX, conveyorY, TileKind.Conveyor);
  world.place(sensorX, sensorY, TileKind.ChargeSensor, sourceSide);
  world.place(inputX, inputY, TileKind.Conduit);
  world.setCharge(inputX, inputY, charge);
  world.setWeld(conveyorX, conveyorY, sensorX, sensorY, true);

  world.place(sensorX + lockX, sensorY + lockY, TileKind.Platform);
  world.setWeld(sensorX, sensorY, sensorX + lockX, sensorY + lockY, true);
  world.place(inputX + lockX, inputY + lockY, TileKind.Platform);
  world.setWeld(inputX, inputY, inputX + lockX, inputY + lockY, true);
}

const ACTIVE_DIRECTIONS = [
  { charge: 1 as const, side: Direction.Up },
  { charge: 1 as const, side: Direction.Right },
  { charge: 1 as const, side: Direction.Down },
  { charge: 1 as const, side: Direction.Left },
  { charge: -1 as const, side: Direction.Up },
  { charge: -1 as const, side: Direction.Right },
  { charge: -1 as const, side: Direction.Down },
  { charge: -1 as const, side: Direction.Left },
];

describe("conveyor belt forces", () => {
  it.each(ACTIVE_DIRECTIONS)(
    "moves an unwelded $side-side neighbor tangentially with charge $charge",
    ({ charge, side }) => {
      const world = new World(9, 9);
      const conveyorX = 4;
      const conveyorY = 4;
      const sourceSide = rotate(side, 2);
      placeFixedPoweredConveyor(world, conveyorX, conveyorY, charge, sourceSide);
      const targetX = conveyorX + DIRECTION_X[side];
      const targetY = conveyorY + DIRECTION_Y[side];
      const targetId = world.place(targetX, targetY, TileKind.Stone);
      const forceDirection = rotate(side, charge);
      const expectedX = targetX + DIRECTION_X[forceDirection];
      const expectedY = targetY + DIRECTION_Y[forceDirection];

      const movementCount = new Simulation(world).step();

      expect(movementCount).toBe(1);
      expect(world.idAt(expectedX, expectedY)).toBe(targetId);
    },
  );

  it("stops when its resolved circuit charge is neutral", () => {
    const world = new World(9, 9);
    placeFixedPoweredConveyor(world, 4, 4, 0, Direction.Down);
    const targetId = world.place(4, 3, TileKind.Stone);

    expect(new Simulation(world).step()).toBe(0);
    expect(world.idAt(4, 3)).toBe(targetId);
    expect(world.chargeAt(4, 4)).toBe(0);
  });

  it("pushes a complete body chain before committing any movement", () => {
    const world = new World(9, 9);
    placeFixedPoweredConveyor(world, 4, 4, 1, Direction.Down);
    const firstId = world.place(4, 3, TileKind.Stone);
    const secondId = world.place(5, 3, TileKind.Iron);

    expect(new Simulation(world).step()).toBe(2);
    expect(world.idAt(5, 3)).toBe(firstId);
    expect(world.idAt(6, 3)).toBe(secondId);
  });

  it("jams equal-priority conveyor moves that claim the same destination", () => {
    const world = new World(9, 9);
    placeFixedPoweredConveyor(world, 2, 4, 1, Direction.Down);
    placeFixedPoweredConveyor(world, 4, 4, -1, Direction.Down);
    const leftId = world.place(2, 3, TileKind.Stone);
    const rightId = world.place(4, 3, TileKind.Iron);

    expect(new Simulation(world).step()).toBe(0);
    expect(world.idAt(2, 3)).toBe(leftId);
    expect(world.idAt(4, 3)).toBe(rightId);
    expect(world.kindAt(3, 3)).toBe(TileKind.Empty);
  });

  it("applies the opposite reaction force to its own welded body", () => {
    const world = new World(8, 7);
    const conveyorId = world.place(3, 3, TileKind.Conveyor);
    const sensorId = world.place(4, 3, TileKind.ChargeSensor, Direction.Right);
    world.setWeld(3, 3, 4, 3, true);
    world.place(5, 3, TileKind.Conduit);
    world.setCharge(5, 3, 1);
    world.place(5, 4, TileKind.Platform);
    world.setWeld(5, 3, 5, 4, true);
    const targetId = world.place(3, 2, TileKind.Stone);

    expect(new Simulation(world).step()).toBe(3);
    expect(world.idAt(2, 3)).toBe(conveyorId);
    expect(world.idAt(3, 3)).toBe(sensorId);
    expect(world.idAt(4, 2)).toBe(targetId);
  });

  it("does not apply force across a welded edge", () => {
    const world = new World(9, 9);
    placeFixedPoweredConveyor(world, 4, 4, 1, Direction.Down);
    const targetId = world.place(4, 3, TileKind.Stone);
    world.setWeld(4, 4, 4, 3, true);

    expect(new Simulation(world).step()).toBe(0);
    expect(world.idAt(4, 3)).toBe(targetId);
  });
});

describe("conveyor belt metadata", () => {
  it("connects one circuit network on every side and round-trips through board JSON", () => {
    expect(TILE_DEFINITIONS[TileKind.Conveyor].circuitPorts).toBe(WeldSide.All);

    const world = new World(1, 1);
    world.place(0, 0, TileKind.Conveyor);
    world.setCharge(0, 0, -1);
    const serialized = serializeBoard(world, 12);
    expect(JSON.parse(serialized)).toMatchObject({
      version: 7,
      tick: 12,
      grid: ["B"],
      charges: [{ x: 0, y: 0, charge: -1 }],
    });

    const imported = deserializeBoard(serialized);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.Conveyor);
    expect(imported.world.chargeAt(0, 0)).toBe(-1);
  });
});
