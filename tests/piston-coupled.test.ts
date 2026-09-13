import { describe, expect, it } from "vitest";

import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

interface PoweredPiston {
  y: number;
  pistonId: number;
  sourceId: number;
}

function placeUpStack(world: World, x: number, top: number, count: number): PoweredPiston[] {
  return Array.from({ length: count }, (_, offset) => {
    const y = top + offset;
    const pistonId = world.place(x, y, TileKind.Piston, Direction.Up);
    const sourceId = world.place(x + 1, y, TileKind.FixedCharge);
    world.setWeld(x, y, x + 1, y, true);
    return { y, pistonId, sourceId };
  });
}

function expectExtendedUpStack(world: World, x: number, stack: readonly PoweredPiston[]): void {
  const originalIds = stack.flatMap(({ pistonId, sourceId }) => [pistonId, sourceId]);
  const baseIds = new Set<number>();
  stack.forEach(({ y, pistonId, sourceId }, offset) => {
    const baseY = y - (stack.length - offset - 1);
    expect(world.kindAt(x, baseY)).toBe(TileKind.PistonBase);
    expect(world.orientationAt(x, baseY)).toBe(Direction.Up);
    expect(world.chargeAt(x, baseY)).toBe(1);
    expect(world.idAt(x, baseY)).not.toBe(0);
    expect(originalIds).not.toContain(world.idAt(x, baseY));
    baseIds.add(world.idAt(x, baseY));
    expect(world.tileAt(x, baseY - 1)).toEqual({ kind: TileKind.PistonArm, id: pistonId });
    expect(world.orientationAt(x, baseY - 1)).toBe(Direction.Up);
    expect(world.tileAt(x + 1, baseY)).toEqual({ kind: TileKind.FixedCharge, id: sourceId });
    expect(world.kindAt(x + 1, baseY - 1)).toBe(TileKind.Empty);
    expect(world.isWelded(x, baseY, x, baseY - 1)).toBe(true);
    expect(world.isWelded(x, baseY, x + 1, baseY)).toBe(true);
  });
  expect(baseIds.size).toBe(stack.length);
}

function geometry(world: World) {
  return Array.from({ length: world.cellCount }, (_, index) => {
    const x = index % world.width;
    const y = Math.floor(index / world.width);
    return {
      ...world.tileAt(x, y),
      orientation: world.orientationAt(x, y),
      rightWeld: world.hasRightWeldAtIndex(index),
      downWeld: world.hasDownWeldAtIndex(index),
    };
  });
}

describe("coupled piston extension", () => {
  it("extends all three upward strokes in one tick while carrying their sources and identities", () => {
    const world = new World(4, 8);
    const stack = placeUpStack(world, 1, 5, 3);

    new Simulation(world).step();

    expectExtendedUpStack(world, 1, stack);
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(1, 2)).toBe(TileKind.PistonArm);
    expect(world.kindAt(1, 3)).toBe(TileKind.PistonBase);
    expect(world.kindAt(1, 5)).toBe(TileKind.PistonBase);
    expect(world.kindAt(1, 7)).toBe(TileKind.PistonBase);
  });

  it("carries a head-welded load through the sum of all three strokes", () => {
    const world = new World(4, 8);
    const stack = placeUpStack(world, 1, 5, 3);
    const loadId = world.place(1, 4, TileKind.Stone);
    const sideLoadId = world.place(0, 4, TileKind.Stone);
    world.setWeld(1, 5, 1, 4, true);
    world.setWeld(1, 4, 0, 4, true);

    new Simulation(world).step();

    expectExtendedUpStack(world, 1, stack);
    expect(world.tileAt(1, 1)).toEqual({ kind: TileKind.Stone, id: loadId });
    expect(world.tileAt(0, 1)).toEqual({ kind: TileKind.Stone, id: sideLoadId });
    expect(world.isWelded(1, 2, 1, 1)).toBe(true);
    expect(world.isWelded(1, 1, 0, 1)).toBe(true);
    expect(world.kindAt(0, 4)).toBe(TileKind.Empty);
  });

  it("rejects a ceiling-blocked combined stroke without jamming an unrelated piston", () => {
    const world = new World(10, 7);
    const stack = placeUpStack(world, 1, 4, 3);
    const ceilingId = world.place(1, 1, TileKind.Platform);
    const freeStack = placeUpStack(world, 7, 6, 1);

    new Simulation(world).step();

    for (const { y, pistonId, sourceId } of stack) {
      expect(world.tileAt(1, y)).toEqual({ kind: TileKind.Piston, id: pistonId });
      expect(world.tileAt(2, y)).toEqual({ kind: TileKind.FixedCharge, id: sourceId });
      expect(world.isWelded(1, y, 2, y)).toBe(true);
    }
    expect(world.tileAt(1, 1)).toEqual({ kind: TileKind.Platform, id: ceilingId });
    expect(world.kindAt(1, 2)).toBe(TileKind.Empty);
    expect(world.kindAt(1, 3)).toBe(TileKind.Empty);
    expectExtendedUpStack(world, 7, freeStack);
  });

  it("sums horizontal strokes in both mirrored scan directions", () => {
    for (const direction of [Direction.Right, Direction.Left]) {
      const world = new World(8, 3);
      const sign = direction === Direction.Right ? 1 : -1;
      const origin = direction === Direction.Right ? 0 : 7;
      const stack = Array.from({ length: 3 }, (_, offset) => {
        const x = origin + offset * sign;
        const pistonId = world.place(x, 2, TileKind.Piston, direction);
        const sourceId = world.place(x, 1, TileKind.FixedCharge);
        world.setWeld(x, 2, x, 1, true);
        return { pistonId, sourceId };
      });
      const loadId = world.place(origin + 3 * sign, 2, TileKind.Stone);
      world.setWeld(origin + 2 * sign, 2, origin + 3 * sign, 2, true);
      const originalIds = [loadId, ...stack.flatMap(({ pistonId, sourceId }) => [pistonId, sourceId])];
      const baseIds = new Set<number>();

      new Simulation(world).step();

      stack.forEach(({ pistonId, sourceId }, offset) => {
        const baseX = origin + 2 * offset * sign;
        const armX = baseX + sign;
        expect(world.kindAt(baseX, 2)).toBe(TileKind.PistonBase);
        expect(world.orientationAt(baseX, 2)).toBe(direction);
        expect(world.chargeAt(baseX, 2)).toBe(1);
        expect(world.idAt(baseX, 2)).not.toBe(0);
        expect(originalIds).not.toContain(world.idAt(baseX, 2));
        baseIds.add(world.idAt(baseX, 2));
        expect(world.tileAt(armX, 2)).toEqual({ kind: TileKind.PistonArm, id: pistonId });
        expect(world.orientationAt(armX, 2)).toBe(direction);
        expect(world.tileAt(baseX, 1)).toEqual({ kind: TileKind.FixedCharge, id: sourceId });
        expect(world.kindAt(armX, 1)).toBe(TileKind.Empty);
        expect(world.isWelded(baseX, 2, armX, 2)).toBe(true);
        expect(world.isWelded(baseX, 2, baseX, 1)).toBe(true);
      });
      expect(baseIds.size).toBe(3);
      expect(world.tileAt(origin + 6 * sign, 2)).toEqual({ kind: TileKind.Stone, id: loadId });
      expect(world.isWelded(origin + 5 * sign, 2, origin + 6 * sign, 2)).toBe(true);
      expect(world.kindAt(origin + 7 * sign, 2)).toBe(TileKind.Empty);
    }
  });

  it("carries a positively charged extended piston rigidly without adding another stroke", () => {
    const world = new World(4, 8);
    const stack = placeUpStack(world, 1, 6, 2);
    const baseId = world.place(1, 5, TileKind.PistonBase, Direction.Up);
    const armId = world.place(1, 4, TileKind.PistonArm, Direction.Up);
    const sourceId = world.place(2, 5, TileKind.FixedCharge);
    const loadId = world.place(1, 3, TileKind.Stone);
    world.setWeld(1, 5, 1, 4, true);
    world.setWeld(1, 5, 2, 5, true);
    world.setWeld(1, 4, 1, 3, true);

    new Simulation(world).step();

    expectExtendedUpStack(world, 1, stack);
    expect(world.tileAt(1, 3)).toEqual({ kind: TileKind.PistonBase, id: baseId });
    expect(world.tileAt(1, 2)).toEqual({ kind: TileKind.PistonArm, id: armId });
    expect(world.tileAt(2, 3)).toEqual({ kind: TileKind.FixedCharge, id: sourceId });
    expect(world.tileAt(1, 1)).toEqual({ kind: TileKind.Stone, id: loadId });
    expect(world.chargeAt(1, 3)).toBe(1);
    expect(world.isWelded(1, 3, 1, 2)).toBe(true);
    expect(world.isWelded(1, 3, 2, 3)).toBe(true);
    expect(world.isWelded(1, 2, 1, 1)).toBe(true);
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
  });

  it("jams opposite strokes that drive two load chains into the same cell without a winner", () => {
    const world = new World(9, 5);
    world.place(1, 3, TileKind.Piston, Direction.Right);
    world.place(7, 3, TileKind.Piston, Direction.Left);
    world.place(0, 3, TileKind.FixedCharge);
    world.place(8, 3, TileKind.FixedCharge);
    for (const x of [2, 3, 5, 6]) {
      world.place(x, 3, TileKind.Stone);
    }
    for (let x = 1; x <= 7; x += 1) {
      world.place(x, 4, TileKind.Platform);
    }
    world.setWeld(1, 3, 0, 3, true);
    world.setWeld(7, 3, 8, 3, true);
    world.setWeld(1, 3, 1, 4, true);
    world.setWeld(7, 3, 7, 4, true);
    const before = geometry(world);

    new Simulation(world).step();

    expect(geometry(world)).toEqual(before);
    expect(world.chargeAt(1, 3)).toBe(1);
    expect(world.chargeAt(7, 3)).toBe(1);
  });

  it("jams perpendicular demands on one load rather than moving it diagonally or overlapping", () => {
    const world = new World(6, 6);
    world.place(3, 4, TileKind.Piston, Direction.Up);
    world.place(2, 3, TileKind.Piston, Direction.Right);
    world.place(4, 4, TileKind.FixedCharge);
    world.place(1, 3, TileKind.FixedCharge);
    world.place(3, 3, TileKind.Stone);
    world.place(3, 5, TileKind.Platform);
    world.place(2, 4, TileKind.Platform);
    world.setWeld(3, 4, 4, 4, true);
    world.setWeld(2, 3, 1, 3, true);
    world.setWeld(3, 4, 3, 5, true);
    world.setWeld(2, 3, 2, 4, true);
    const before = geometry(world);

    new Simulation(world).step();

    expect(geometry(world)).toEqual(before);
    expect(world.chargeAt(3, 4)).toBe(1);
    expect(world.chargeAt(2, 3)).toBe(1);
  });

  it("rejects every rival swept by a recoiling body, regardless of member order", () => {
    for (const reflected of [false, true]) {
      const world = new World(8, 6);
      const x = (column: number) => reflected ? 7 - column : column;
      for (let column = 0; column < 8; column += 1) {
        world.place(column, 5, TileKind.Platform);
      }
      for (const y of [1, 4]) {
        world.place(x(6), y, TileKind.Piston, Direction.Down);
        world.place(x(5), y, TileKind.FixedCharge);
        world.setWeld(x(6), y, x(5), y, true);
      }
      world.place(x(4), 3, TileKind.Piston, reflected ? Direction.Left : Direction.Right);
      world.place(x(4), 4, TileKind.FixedCharge);
      world.setWeld(x(4), 3, x(4), 4, true);

      new Simulation(world).step();

      // Gravity first lowers the upper piston. Its new head and the sideways
      // head then conflict with different members of the same recoil proposal.
      expect(world.kindAt(x(6), 2)).toBe(TileKind.Piston);
      expect(world.kindAt(x(4), 3)).toBe(TileKind.Piston);
      expect(world.kindAt(x(6), 4)).toBe(TileKind.Piston);
      expect(world.kindAt(x(5), 3)).toBe(TileKind.Empty);
      expect(world.kindAt(x(6), 3)).toBe(TileKind.Empty);
    }
  });

  it("discovers in-board dependencies even when a summed push crosses the boundary", () => {
    for (const reflected of [false, true]) {
      const world = new World(10, 4);
      const x = (column: number) => reflected ? 9 - column : column;
      const forward = reflected ? Direction.Left : Direction.Right;
      const reverse = reflected ? Direction.Right : Direction.Left;
      const pistonIds: number[] = [];
      for (const column of [6, 7]) {
        pistonIds.push(world.place(x(column), 0, TileKind.Piston, forward));
        world.place(x(column), 1, TileKind.FixedCharge);
        world.setWeld(x(column), 0, x(column), 1, true);
      }
      world.place(x(8), 0, TileKind.Stone);
      world.place(x(9), 0, TileKind.FixedCharge);
      const opposingId = world.place(x(9), 1, TileKind.Piston, reverse);
      world.setWeld(x(9), 0, x(9), 1, true);

      new Simulation(world).step();

      expect(world.kindAt(x(4), 1)).toBe(TileKind.PistonBase);
      expect(world.kindAt(x(6), 1)).toBe(TileKind.PistonBase);
      expect(world.idAt(x(5), 1)).toBe(pistonIds[0]);
      expect(world.idAt(x(7), 1)).toBe(pistonIds[1]);
      expect(world.tileAt(x(9), 2)).toEqual({ kind: TileKind.Piston, id: opposingId });
      expect(world.kindAt(x(8), 2)).toBe(TileKind.Empty);
    }
  });

  it("preserves a 129-cell carried displacement without signed-byte overflow", () => {
    const world = new World(4, 259);
    const stack = placeUpStack(world, 1, 130, 129);
    const loadId = world.place(1, 129, TileKind.Stone);
    world.setWeld(1, 130, 1, 129, true);

    new Simulation(world).step();

    expectExtendedUpStack(world, 1, stack);
    expect(world.tileAt(1, 0)).toEqual({ kind: TileKind.Stone, id: loadId });
    expect(world.isWelded(1, 1, 1, 0)).toBe(true);
  });
});
