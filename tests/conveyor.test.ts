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

function placeFixedMagneticCeiling(world: World, startX: number, endX: number): void {
  for (let x = startX; x <= endX; x += 1) {
    world.place(x, 0, TileKind.Platform);
    world.place(x, 1, TileKind.Iron);
    world.setWeld(x, 0, x, 1, true);
  }
}

function placeCeilingCrawler(
  world: World,
  magnetX: number,
): { readonly magnetId: number; readonly sensorId: number; readonly conveyorId: number } {
  const magnetId = world.place(magnetX, 2, TileKind.Magnet, Direction.Up);
  const sensorId = world.place(magnetX + 1, 2, TileKind.Sensor, Direction.Up);
  const conveyorId = world.place(magnetX + 2, 2, TileKind.Conveyor);
  world.setWeld(magnetX, 2, magnetX + 1, 2, true);
  world.setWeld(magnetX + 1, 2, magnetX + 2, 2, true);
  return { magnetId, sensorId, conveyorId };
}

const ACTIVE_DIRECTIONS = [
  { charge: 1 as const, side: Direction.Up },
  { charge: 1 as const, side: Direction.Right },
  { charge: 1 as const, side: Direction.Down },
  { charge: -1 as const, side: Direction.Up },
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
      if (side === Direction.Down) {
        world.place(targetX, targetY + 1, TileKind.Platform);
      }
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
    world.place(5, 4, TileKind.Platform);

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
    world.place(4, 4, TileKind.Platform);

    expect(new Simulation(world).step()).toBe(3);
    expect(world.idAt(2, 3)).toBe(conveyorId);
    expect(world.idAt(3, 3)).toBe(sensorId);
    expect(world.idAt(4, 2)).toBe(targetId);
  });

  it("lets an unsupported powered assembly fall instead of gripping a ceiling", () => {
    const world = new World(8, 7);
    for (let x = 1; x <= 6; x += 1) {
      world.place(x, 1, TileKind.Platform);
    }
    const sensorId = world.place(3, 2, TileKind.Sensor, Direction.Up);
    const conveyorId = world.place(4, 2, TileKind.Conveyor);
    world.setWeld(3, 2, 4, 2, true);

    expect(new Simulation(world).step()).toBe(2);
    expect(world.idAt(3, 3)).toBe(sensorId);
    expect(world.idAt(4, 3)).toBe(conveyorId);
  });

  it("slides a magnetically supported assembly along a fixed ceiling", () => {
    const world = new World(8, 7);
    placeFixedMagneticCeiling(world, 0, 6);
    const { magnetId, sensorId, conveyorId } = placeCeilingCrawler(world, 2);

    expect(new Simulation(world).step()).toBe(3);
    expect(world.idAt(1, 2)).toBe(magnetId);
    expect(world.idAt(2, 2)).toBe(sensorId);
    expect(world.idAt(3, 2)).toBe(conveyorId);
  });

  it("falls on the tick after sliding beyond a magnetic ceiling", () => {
    const world = new World(8, 7);
    placeFixedMagneticCeiling(world, 1, 4);
    const { magnetId, sensorId, conveyorId } = placeCeilingCrawler(world, 2);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(3);
    expect(simulation.step()).toBe(3);
    expect(world.idAt(0, 2)).toBe(magnetId);
    expect(simulation.step()).toBe(3);
    expect(world.idAt(0, 3)).toBe(magnetId);
    expect(world.idAt(1, 3)).toBe(sensorId);
    expect(world.idAt(2, 3)).toBe(conveyorId);
  });

  it("remains magnetically supported when tangential movement hits a wall", () => {
    const world = new World(8, 7);
    placeFixedMagneticCeiling(world, 0, 6);
    const { magnetId, sensorId, conveyorId } = placeCeilingCrawler(world, 0);

    expect(new Simulation(world).step()).toBe(0);
    expect(world.idAt(0, 2)).toBe(magnetId);
    expect(world.idAt(1, 2)).toBe(sensorId);
    expect(world.idAt(2, 2)).toBe(conveyorId);
  });

  it("moves a free magnetic target with normal conveyor movement", () => {
    const world = new World(9, 9);
    placeFixedPoweredConveyor(world, 4, 4, -1, Direction.Down);
    const magnetId = world.place(4, 3, TileKind.Magnet, Direction.Right);
    const ironId = world.place(5, 3, TileKind.Iron);

    expect(new Simulation(world).step()).toBe(2);
    expect(world.idAt(3, 3)).toBe(magnetId);
    expect(world.idAt(4, 3)).toBe(ironId);
  });

  it("blocks conveyor movement normal to a fixed magnetic contact", () => {
    const world = new World(9, 9);
    placeFixedPoweredConveyor(world, 4, 4, -1, Direction.Down);
    const magnetId = world.place(4, 3, TileKind.Magnet, Direction.Right);
    world.place(5, 3, TileKind.Iron);
    world.place(6, 3, TileKind.Platform);
    world.setWeld(5, 3, 6, 3, true);

    expect(new Simulation(world).step()).toBe(0);
    expect(world.idAt(4, 3)).toBe(magnetId);
  });

  it("does not lift a gravity-affected block from fixed support", () => {
    const world = new World(9, 9);
    placeFixedPoweredConveyor(world, 4, 4, -1, Direction.Left);
    const targetId = world.place(5, 4, TileKind.Stone);
    world.place(5, 5, TileKind.Platform);

    expect(new Simulation(world).step()).toBe(0);
    expect(world.idAt(5, 4)).toBe(targetId);
  });

  it.each([-1, 1] as const)(
    "lets unsupported blocks fall symmetrically beside a conveyor with charge %i",
    (charge) => {
      const world = new World(9, 9);
      placeFixedPoweredConveyor(world, 4, 4, charge, Direction.Up);
      const leftId = world.place(3, 4, TileKind.Stone);
      const rightId = world.place(5, 4, TileKind.Iron);

      expect(new Simulation(world).step()).toBe(2);
      expect(world.idAt(3, 5)).toBe(leftId);
      expect(world.idAt(5, 5)).toBe(rightId);
    },
  );

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
      version: 11,
      tick: 12,
      grid: ["B"],
      charges: [{ x: 0, y: 0, charge: -1 }],
    });

    const imported = deserializeBoard(serialized);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.Conveyor);
    expect(imported.world.chargeAt(0, 0)).toBe(-1);
  });
});
