import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { RotatorResolver } from "../src/simulation/rotator-resolver";
import { Simulation } from "../src/simulation/simulation";
import {
  Direction,
  directionX,
  directionY,
  TileKind,
} from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function chargeRotator(world: World, x: number, y: number, charge: -1 | 1): void {
  world.setCharge(x, y, charge);
}

function weldRing(world: World, left: number, top: number, size: number): void {
  const right = left + size - 1;
  const bottom = top + size - 1;
  for (let x = left; x < right; x += 1) {
    world.setWeld(x, top, x + 1, top, true);
    world.setWeld(x, bottom, x + 1, bottom, true);
  }
  for (let y = top; y < bottom; y += 1) {
    world.setWeld(left, y, left, y + 1, true);
    world.setWeld(right, y, right, y + 1, true);
  }
}

describe("rotators", () => {
  it("mirrors its grip direction when duplicated", () => {
    const world = new World(3, 5);
    world.place(1, 2, TileKind.Duplicator, Direction.Up);
    world.place(1, 3, TileKind.Rotator, Direction.Right);
    world.setRotatorDirectionAtIndex(10, Direction.Down);
    const sourceForDestination = new Int32Array(world.cellCount);
    const destinationOwners = new Int32Array(world.cellCount);
    sourceForDestination.fill(-1);
    destinationOwners.fill(-1);
    sourceForDestination[4] = 10;
    destinationOwners[4] = 7;

    world.applyDuplications(sourceForDestination, destinationOwners);

    expect(world.kindAt(1, 1)).toBe(TileKind.Rotator);
    expect(world.orientationAt(1, 1)).toBe(Direction.Right);
    expect(world.rotatorDirectionAtIndex(4)).toBe(Direction.Up);
  });

  it("uses the resolved rear charge and stops before pointing toward its input", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    world.place(3, 4, TileKind.FixedCharge);
    world.place(3, 5, TileKind.Platform);
    world.setWeld(3, 3, 3, 4, true);
    world.setWeld(3, 4, 3, 5, true);
    world.place(4, 4, TileKind.Platform);
    const targetId = world.place(3, 2, TileKind.Stone);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(1);
    expect(world.idAt(4, 3)).toBe(targetId);
    expect(world.componentStateSnapshotAt(3, 3)).toEqual({
      type: "rotator",
      direction: Direction.Right,
    });

    expect(simulation.step()).toBe(0);
    expect(world.idAt(4, 3)).toBe(targetId);
    expect(world.componentStateSnapshotAt(3, 3)).toEqual({
      type: "rotator",
      direction: Direction.Right,
    });
  });

  it.each([Direction.Up, Direction.Right, Direction.Down, Direction.Left])(
    "reverses signed turns when mirrored at orientation %s without entering the rear",
    (orientation) => {
      for (const charge of [-1, 1] as const) {
        const world = new World(7, 7);
        world.place(3, 3, TileKind.Rotator, orientation, true);
        const target = world.place(
          3 + directionX(orientation), 3 + directionY(orientation),
          TileKind.Selector, orientation, true,
        );
        chargeRotator(world, 3, 3, charge);
        const resolver = new RotatorResolver(world);
        const destination = ((orientation - charge + 4) & 3) as Direction;
        const x = 3 + directionX(destination);
        const y = 3 + directionY(destination);
        expect(resolver.resolve()).toBe(1);
        expect(world.idAt(x, y)).toBe(target);
        expect(world.orientationAt(x, y)).toBe(destination);
        expect(world.mirroredAt(x, y)).toBe(true);
        expect(world.rotatorDirectionAtIndex(24)).toBe(destination);
        expect(resolver.resolve()).toBe(0);
        expect(world.idAt(x, y)).toBe(target);
        chargeRotator(world, 3, 3, charge === 1 ? -1 : 1);
        expect(resolver.resolve()).toBe(1);
        expect(world.idAt(3 + directionX(orientation), 3 + directionY(orientation))).toBe(target);
      }
    },
  );

  it("rotates a complete welded body, its orientations, and its weld topology", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    chargeRotator(world, 3, 3, 1);
    const firstId = world.place(3, 2, TileKind.Sensor, Direction.Right);
    const secondId = world.place(4, 2, TileKind.Conduit);
    world.setWeld(3, 2, 4, 2, true);

    expect(new RotatorResolver(world).resolve()).toBe(2);

    expect(world.idAt(4, 3)).toBe(firstId);
    expect(world.orientationAt(4, 3)).toBe(Direction.Down);
    expect(world.idAt(4, 4)).toBe(secondId);
    expect(world.isWelded(4, 3, 4, 4)).toBe(true);
    expect(world.kindAt(3, 2)).toBe(TileKind.Empty);
  });

  it("recursively carries bodies touched by swept-up bodies", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    chargeRotator(world, 3, 3, 1);
    const firstId = world.place(3, 2, TileKind.Stone);
    const secondId = world.place(4, 2, TileKind.Stone);
    const thirdId = world.place(4, 4, TileKind.Stone);

    expect(new RotatorResolver(world).resolve()).toBe(3);

    expect(world.idAt(4, 3)).toBe(firstId);
    expect(world.idAt(4, 4)).toBe(secondId);
    expect(world.idAt(2, 4)).toBe(thirdId);
  });

  it("carries loose bodies enclosed by a welded container", () => {
    const world = new World(8, 8);
    world.place(2, 4, TileKind.Rotator, Direction.Up);
    chargeRotator(world, 2, 4, 1);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        if (x === 2 && y === 2) {
          continue;
        }
        world.place(x, y, TileKind.Stone);
      }
    }
    weldRing(world, 1, 1, 3);
    const looseId = world.place(2, 2, TileKind.Iron);

    expect(new RotatorResolver(world).resolve()).toBe(9);

    expect(world.idAt(4, 4)).toBe(looseId);
    expect(world.kindAt(2, 2)).toBe(TileKind.Empty);
    expect(world.isWelded(3, 3, 4, 3)).toBe(true);
  });

  it("blocks the complete turn on fixed terrain or a world-boundary sweep", () => {
    const collisionWorld = new World(7, 7);
    collisionWorld.place(3, 3, TileKind.Rotator, Direction.Up);
    chargeRotator(collisionWorld, 3, 3, 1);
    const targetId = collisionWorld.place(3, 2, TileKind.Stone);
    collisionWorld.place(4, 3, TileKind.Platform);
    collisionWorld.place(3, 4, TileKind.Platform);
    collisionWorld.setWeld(3, 3, 3, 4, true);

    expect(new RotatorResolver(collisionWorld).resolve()).toBe(0);
    expect(collisionWorld.idAt(3, 2)).toBe(targetId);
    expect(collisionWorld.componentStateSnapshotAt(3, 3)).toEqual({
      type: "rotator",
      direction: Direction.Up,
    });

    const boundaryWorld = new World(4, 4);
    boundaryWorld.place(0, 1, TileKind.Rotator, Direction.Left);
    boundaryWorld.setRotatorDirectionAtIndex(4, Direction.Up);
    chargeRotator(boundaryWorld, 0, 1, -1);
    const boundaryTargetId = boundaryWorld.place(0, 0, TileKind.Stone);
    boundaryWorld.place(1, 1, TileKind.Platform);
    boundaryWorld.setWeld(0, 1, 1, 1, true);

    expect(new RotatorResolver(boundaryWorld).resolve()).toBe(0);
    expect(boundaryWorld.idAt(0, 0)).toBe(boundaryTargetId);
    expect(boundaryWorld.rotatorDirectionAtIndex(4)).toBe(Direction.Up);
  });

  it.each([false, true])("reacts against a fixed grip with mirrored=%s", (mirrored) => {
    for (const charge of [-1, 1] as const) {
      const world = new World(7, 7);
      const rotator = world.place(3, 3, TileKind.Rotator, Direction.Up, mirrored);
      const grip = world.place(3, 2, TileKind.Platform);
      const rear = world.place(3, 4, TileKind.Sensor, Direction.Down);
      world.setWeld(3, 3, 3, 4, true);
      chargeRotator(world, 3, 3, charge);
      const resolver = new RotatorResolver(world);
      const turn = mirrored ? -charge : charge;
      const nextOrientation = ((4 - turn) & 3) as Direction;

      expect(resolver.resolve()).toBe(2);
      expect(world.idAt(3, 3)).toBe(rotator);
      expect(world.idAt(3, 2)).toBe(grip);
      expect(world.orientationAt(3, 3)).toBe(nextOrientation);
      expect(world.mirroredAt(3, 3)).toBe(mirrored);
      expect(world.rotatorDirectionAtIndex(24)).toBe(Direction.Up);
      expect(world.idAt(3 + turn, 3)).toBe(rear);
      expect(world.orientationAt(3 + turn, 3)).toBe(turn === 1 ? Direction.Right : Direction.Left);
      expect(world.isWelded(3, 3, 3 + turn, 3)).toBe(true);
      // The same command would now put the grip behind the rotated base.
      expect(resolver.resolve()).toBe(0);
      expect(world.orientationAt(3, 3)).toBe(nextOrientation);
      chargeRotator(world, 3, 3, charge === 1 ? -1 : 1);
      expect(resolver.resolve()).toBe(2);
      expect(world.orientationAt(3, 3)).toBe(Direction.Up);
      expect(world.idAt(3, 4)).toBe(rear);
      expect(world.rotatorDirectionAtIndex(24)).toBe(Direction.Up);
    }
  });

  it.each([Direction.Up, Direction.Down])(
    "carries an active empty-grip rotator during reaction facing %s",
    (orientation) => {
      const world = new World(7, 7);
      const dy = directionY(orientation);
      const carriedOrientation = ((orientation + 2) & 3) as Direction;
      world.place(3, 3, TileKind.Rotator, orientation);
      const grip = world.place(3, 3 + dy, TileKind.Platform);
      const carried = world.place(3, 3 - dy, TileKind.Rotator, carriedOrientation);
      world.setWeld(3, 3, 3, 3 - dy, true);
      chargeRotator(world, 3, 3, 1);
      chargeRotator(world, 3, 3 - dy, 1);
      const resolver = new RotatorResolver(world);
      const destinationX = 3 - dy;
      const destination = 3 * world.width + destinationX;

      // Both scan orders must combine the empty grip's turn with the base's turn.
      expect(resolver.resolve()).toBe(2);
      expect(world.idAt(destinationX, 3)).toBe(carried);
      expect(world.idAt(3, 3 + dy)).toBe(grip);
      expect(world.orientationAt(destinationX, 3)).toBe((carriedOrientation + 3) & 3);
      expect(world.rotatorDirectionAtIndex(destination)).toBe(carriedOrientation);
      expect(world.isWelded(3, 3, destinationX, 3)).toBe(true);

      chargeRotator(world, 3, 3, -1);
      chargeRotator(world, destinationX, 3, -1);
      expect(resolver.resolve()).toBe(2);
      expect(world.idAt(3, 3 - dy)).toBe(carried);
      expect(world.orientationAt(3, 3)).toBe(orientation);
      expect(world.orientationAt(3, 3 - dy)).toBe(carriedOrientation);
      expect(world.rotatorDirectionAtIndex((3 - dy) * world.width + 3)).toBe(carriedOrientation);
      expect(world.rotatorDirectionAtIndex(24)).toBe(orientation);
      expect(world.isWelded(3, 3, 3, 3 - dy)).toBe(true);
    },
  );

  it("reacts when a movable grip hits terrain, without carrying the grip", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    const grip = world.place(3, 2, TileKind.Stone);
    world.place(4, 2, TileKind.Platform);
    chargeRotator(world, 3, 3, 1);

    expect(new RotatorResolver(world).resolve()).toBe(1);
    expect(world.idAt(3, 2)).toBe(grip);
    expect(world.orientationAt(3, 3)).toBe(Direction.Left);
    expect(world.rotatorDirectionAtIndex(24)).toBe(Direction.Up);
  });

  it("blocks reaction when the base sweeps outside the board", () => {
    const world = new World(4, 4);
    world.place(3, 1, TileKind.Rotator, Direction.Up);
    world.place(3, 0, TileKind.Platform);
    const rear = world.place(3, 2, TileKind.Stone);
    world.setWeld(3, 1, 3, 2, true);
    chargeRotator(world, 3, 1, 1);

    expect(new RotatorResolver(world).resolve()).toBe(0);
    expect(world.idAt(3, 2)).toBe(rear);
    expect(world.orientationAt(3, 1)).toBe(Direction.Up);
  });

  it("cannot react by sweeping the gripped body along with the base", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    world.place(3, 4, TileKind.Stone);
    world.setWeld(3, 3, 3, 4, true);
    world.place(3, 2, TileKind.Stone);
    world.place(4, 2, TileKind.Stone);
    world.place(4, 3, TileKind.Stone);
    world.place(4, 4, TileKind.Stone);
    world.setWeld(3, 2, 4, 2, true);
    world.setWeld(4, 2, 4, 3, true);
    world.setWeld(4, 3, 4, 4, true);
    chargeRotator(world, 3, 3, 1);
    const before = serializeBoard(world, 0);

    expect(new RotatorResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
  });

  it("jams reaction when another rotator would carry its stationary grip away", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    world.place(3, 2, TileKind.Stone);
    world.place(4, 2, TileKind.Platform);
    world.place(2, 2, TileKind.Rotator, Direction.Right);
    chargeRotator(world, 3, 3, 1);
    chargeRotator(world, 2, 2, -1);
    const before = serializeBoard(world, 0);

    expect(new RotatorResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
  });

  it("jams competing reaction turns without choosing a winner", () => {
    const world = new World(7, 7);
    for (const x of [2, 4]) {
      world.place(x, 3, TileKind.Rotator, Direction.Up);
      world.place(x, 2, TileKind.Platform);
      world.place(x, 4, TileKind.Stone);
      world.setWeld(x, 3, x, 4, true);
      chargeRotator(world, x, 3, x === 2 ? 1 : -1);
    }
    const before = serializeBoard(world, 0);

    expect(new RotatorResolver(world).resolve()).toBe(0);
    expect(serializeBoard(world, 0)).toBe(before);
  });

  it("jams simultaneous turns whose swept regions overlap", () => {
    const world = new World(8, 6);
    world.place(2, 3, TileKind.Rotator, Direction.Up);
    world.place(4, 3, TileKind.Rotator, Direction.Up);
    chargeRotator(world, 2, 3, 1);
    chargeRotator(world, 4, 3, -1);
    const leftId = world.place(2, 2, TileKind.Stone);
    const rightId = world.place(4, 2, TileKind.Stone);

    expect(new RotatorResolver(world).resolve()).toBe(0);
    expect(world.idAt(2, 2)).toBe(leftId);
    expect(world.idAt(4, 2)).toBe(rightId);
    expect(world.rotatorDirectionAtIndex(26)).toBe(Direction.Up);
    expect(world.rotatorDirectionAtIndex(28)).toBe(Direction.Up);
  });

  it("round-trips its internal direction and rejects the rear direction", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Rotator, Direction.Right);
    world.setRotatorDirectionAtIndex(0, Direction.Down);

    const serialized = serializeBoard(world, 4);
    expect(JSON.parse(serialized)).toMatchObject({
      version: 15,
      grid: ["r"],
      orientations: [{ x: 0, y: 0, direction: "right" }],
      components: [{ x: 0, y: 0, type: "rotator", direction: "down" }],
    });
    const imported = deserializeBoard(serialized);
    expect(imported.world.componentStateSnapshotAt(0, 0)).toEqual({
      type: "rotator",
      direction: Direction.Down,
    });
    expect(() => imported.world.restoreComponentState(0, 0, {
      type: "rotator",
      direction: Direction.Left,
    })).toThrow(/rear input/);
  });
});
