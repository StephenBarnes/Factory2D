import { describe, expect, it } from "vitest";

import { expectDefined } from "../src/util/assert";

import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";
import { deserializeBoard } from "../src/simulation/board-export";

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

describe("dependency-ordered piston strokes", () => {
  it.each(["#..1P##", "#.C1P##", "#1CCP##"])(
    "extends both chamber pistons vertically first with wiring %s",
    (wiring) => {
      const { world } = deserializeBoard(JSON.stringify({
        format: "factory2d-board", version: 15, width: 7, height: 7,
        tick: 0, result: "in-progress",
        grid: ["#######", "#....##", "#.....#", wiring, "#..P..#", "#..#..#", "#######"],
        orientations: [{ x: 4, y: 3, direction: "right" }, { x: 3, y: 4, direction: "down" }],
        welds: ["+-----|", "|....-|", "|.....|",
          wiring === "#..1P##" ? "|..+.-|" : wiring === "#.C1P##" ? "|.-+.-|" : "|--+.-|",
          "|.....|", "|..|..|", "------."],
      }));
      const horizontalId = world.idAt(4, 3);
      const verticalId = world.idAt(3, 4);
      const simulation = new Simulation(world);
      const baseline = world.clone();

      for (let run = 0; run < 2; run += 1) {
        simulation.step();

        expect(world.kindAt(4, 2)).toBe(TileKind.PistonBase);
        expect(world.tileAt(5, 2)).toEqual({ kind: TileKind.PistonArm, id: horizontalId });
        expect(world.kindAt(3, 3)).toBe(TileKind.PistonBase);
        expect(world.tileAt(3, 4)).toEqual({ kind: TileKind.PistonArm, id: verticalId });
        expect(world.isWelded(3, 2, 4, 2)).toBe(true);
        expect(world.isWelded(3, 2, 3, 3)).toBe(true);
        expect(world.isWelded(4, 2, 5, 2)).toBe(true);
        expect(world.isWelded(3, 3, 3, 4)).toBe(true);
        const extended = geometry(world);
        simulation.step();
        expect(geometry(world)).toEqual(extended);
        simulation.resetTo(baseline);
      }
    },
  );

  it.each([false, true])("breaks recoil cycles vertically with vertical reflection %s, either horizontal facing, and either placement order", (flipY) => {
    for (const reflected of [false, true]) {
      for (const reversed of [false, true]) {
        const world = new World(7, 7);
        const x = (column: number) => reflected ? 6 - column : column;
        const yAt = (row: number) => flipY ? 6 - row : row;
        const placements: [number, number, TileKind, Direction][] = [
          [3, 3, TileKind.FixedCharge, Direction.Up],
          [4, 3, TileKind.Piston, reflected ? Direction.Left : Direction.Right],
          [3, 4, TileKind.Piston, flipY ? Direction.Up : Direction.Down],
          [5, 3, TileKind.Platform, Direction.Up],
          [3, 5, TileKind.Platform, Direction.Up],
          [3, 2, TileKind.Floatstone, Direction.Up],
        ];
        if (reversed) placements.reverse();
        for (const [column, y, kind, direction] of placements) {
          world.place(x(column), yAt(y), kind, direction);
        }
        world.setWeld(x(3), 3, x(4), 3, true);
        world.setWeld(x(3), 3, x(3), yAt(4), true);
        world.setWeld(x(3), 3, x(3), yAt(2), true);
        const horizontalId = world.idAt(x(4), 3);
        const verticalId = world.idAt(x(3), yAt(4));

        new Simulation(world).step();

        expect(world.kindAt(x(4), yAt(2))).toBe(TileKind.PistonBase);
        expect(world.tileAt(x(5), yAt(2))).toEqual({ kind: TileKind.PistonArm, id: horizontalId });
        expect(world.kindAt(x(3), 3)).toBe(TileKind.PistonBase);
        expect(world.tileAt(x(3), yAt(4))).toEqual({ kind: TileKind.PistonArm, id: verticalId });
      }
    }
  });

  it("keeps an acyclic horizontal stroke ahead of the vertical piston carrying it", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.FixedCharge);
    const horizontalId = world.place(4, 3, TileKind.Piston, Direction.Right);
    const verticalId = world.place(3, 4, TileKind.Piston, Direction.Down);
    world.place(3, 5, TileKind.Platform);
    world.place(5, 2, TileKind.Platform);
    world.setWeld(3, 3, 4, 3, true);
    world.setWeld(3, 3, 3, 4, true);

    new Simulation(world).step();

    // The horizontal stroke is not cyclic. Its extended arm then blocks upward recoil.
    expect(world.kindAt(4, 3)).toBe(TileKind.PistonBase);
    expect(world.tileAt(5, 3)).toEqual({ kind: TileKind.PistonArm, id: horizontalId });
    expect(world.tileAt(3, 4)).toEqual({ kind: TileKind.Piston, id: verticalId });
    expect(world.chargeAt(3, 4)).toBe(1);
  });

  it("leaves same-axis carrying cycles jammed without choosing a scan-order winner", () => {
    const world = new World(7, 6);
    world.place(3, 3, TileKind.FixedCharge);
    for (const x of [2, 4]) {
      world.place(x, 3, TileKind.Piston, Direction.Down);
      world.place(x, 4, TileKind.Platform);
      world.setWeld(x, 3, 3, 3, true);
    }
    const before = geometry(world);

    new Simulation(world).step();

    expect(geometry(world)).toEqual(before);
    expect(world.chargeAt(2, 3)).toBe(1);
    expect(world.chargeAt(4, 3)).toBe(1);
  });

  it("alternates head-welded downward pistons instead of deadlocking a pull against recoil", () => {
    const { world } = deserializeBoard(JSON.stringify({
      format: "factory2d-board", version: 15, width: 5, height: 7, tick: 0, result: "in-progress",
      grid: [".....", ".....", ".....", "..1U.", "...P.", ".1UP.", "#####"],
      orientations: [
        { x: 3, y: 3, direction: "right" }, { x: 3, y: 4, direction: "down" },
        { x: 2, y: 5, direction: "right" }, { x: 3, y: 5, direction: "down" },
      ],
      components: [
        { x: 3, y: 3, type: "rom", width: 2, height: 1, cursor: 0,
          wrapX: true, wrapY: true, values: [1, -1] },
        { x: 2, y: 5, type: "rom", width: 2, height: 1, cursor: 0,
          wrapX: true, wrapY: true, values: [-1, 1] },
      ],
      welds: [".....", ".....", ".....", "..-|.", "...|.", ".--..", "----."],
    }));
    const upperId = world.idAt(3, 4);
    const lowerId = world.idAt(3, 5);
    const upperRomId = world.idAt(3, 3);
    const lowerRomId = world.idAt(2, 5);
    const simulation = new Simulation(world);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      simulation.step();
      // Later cycles briefly lose floor contact; gravity settles them next tick.
      const lift = cycle === 0 ? 0 : 1;
      expect(world.kindAt(3, 3 - lift)).toBe(TileKind.PistonBase);
      expect(world.tileAt(3, 4 - lift)).toEqual({ kind: TileKind.PistonArm, id: upperId });
      expect(world.tileAt(3, 5 - lift)).toEqual({ kind: TileKind.Piston, id: lowerId });
      expect(world.idAt(3, 2 - lift)).toBe(upperRomId);
      expect(world.idAt(2, 5 - lift)).toBe(lowerRomId);
      expect(world.isWelded(3, 4 - lift, 3, 5 - lift)).toBe(true);

      simulation.step();
      expect(world.tileAt(3, 3)).toEqual({ kind: TileKind.Piston, id: upperId });
      expect(world.kindAt(3, 4)).toBe(TileKind.PistonBase);
      expect(world.tileAt(3, 5)).toEqual({ kind: TileKind.PistonArm, id: lowerId });
      expect(world.idAt(3, 2)).toBe(upperRomId);
      expect(world.idAt(2, 4)).toBe(lowerRomId);
      expect(world.isWelded(3, 3, 3, 4)).toBe(true);
      expect(world.isWelded(3, 4, 3, 5)).toBe(true);
      expect(world.isWelded(2, 4, 3, 4)).toBe(true);
    }
  });

  it("orders nested pull/recoil cycles independently of orientation and allocated IDs", () => {
    for (const direction of [Direction.Up, Direction.Right, Direction.Down, Direction.Left]) {
      for (const reversed of [false, true]) {
        const world = new World(9, 9);
        const point = (distance: number, side = 0): [number, number] => {
          switch (direction) {
            case Direction.Up: return [4 + side, 4 - distance];
            case Direction.Right: return [4 + distance, 4 + side];
            case Direction.Down: return [4 - side, 4 + distance];
            case Direction.Left: return [4 - distance, 4 - side];
          }
        };
        const placements: [number, number, TileKind, Direction][] = [
          [0, 0, TileKind.PistonBase, direction],
          [1, 0, TileKind.PistonArm, direction],
          [2, 0, TileKind.Piston, direction],
          [3, 0, TileKind.Platform, Direction.Up],
          [0, 1, TileKind.Inverter, (direction + 3) % 4],
          [0, 2, TileKind.FixedCharge, Direction.Up],
          [0, -1, TileKind.Floatstone, Direction.Up],
          [2, 1, TileKind.FixedCharge, Direction.Up],
        ];
        if (reversed) placements.reverse();
        for (const [distance, side, kind, facing] of placements) {
          world.place(...point(distance, side), kind, facing);
        }
        world.setWeld(...point(0), ...point(1), true);
        world.setWeld(...point(1), ...point(2), true);
        world.setWeld(...point(0), ...point(0, 1), true);
        world.setWeld(...point(0, 1), ...point(0, 2), true);
        world.setWeld(...point(0), ...point(0, -1), true);
        world.setWeld(...point(2), ...point(2, 1), true);
        world.setCharge(...point(0, 2), 1);
        const pullingId = world.idAt(...point(1));
        const extendingId = world.idAt(...point(2));
        const carriedSourceId = world.idAt(...point(2, 1));

        new Simulation(world).step();

        expect(world.tileAt(...point(0))).toEqual({ kind: TileKind.Piston, id: pullingId });
        expect(world.kindAt(...point(1))).toBe(TileKind.PistonBase);
        expect(world.tileAt(...point(2))).toEqual({ kind: TileKind.PistonArm, id: extendingId });
        expect(world.idAt(...point(1, 1))).toBe(carriedSourceId);
        expect(world.isWelded(...point(0), ...point(1))).toBe(true);
        expect(world.isWelded(...point(1), ...point(2))).toBe(true);
        expect(world.isWelded(...point(1), ...point(1, 1))).toBe(true);
      }
    }
  });

  it("does not let a cycle-breaking vertical stroke bypass ordinary collision jams", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.FixedCharge);
    world.place(4, 3, TileKind.Piston, Direction.Right);
    world.place(3, 4, TileKind.Piston, Direction.Down);
    world.place(5, 3, TileKind.Platform);
    world.place(3, 5, TileKind.Platform);
    world.setWeld(3, 3, 4, 3, true);
    world.setWeld(3, 3, 3, 4, true);
    // Both independent heads claim (3, 2), which the vertical recoil also needs.
    world.place(2, 2, TileKind.Piston, Direction.Right);
    world.place(1, 2, TileKind.FixedCharge);
    world.place(0, 2, TileKind.Platform);
    world.setWeld(2, 2, 1, 2, true);
    world.setWeld(1, 2, 0, 2, true);
    world.place(3, 1, TileKind.Piston, Direction.Down);
    world.place(3, 0, TileKind.FixedCharge);
    world.place(4, 0, TileKind.Platform);
    world.setWeld(3, 1, 3, 0, true);
    world.setWeld(3, 0, 4, 0, true);
    const before = geometry(world);

    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();

    expect(geometry(world)).toEqual(before);
    for (const [x, y] of [[4, 3], [3, 4], [2, 2], [3, 1]] as const) {
      expect(world.chargeAt(x, y)).toBe(1);
    }
  });

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

  it("extends the two distal strokes below a ceiling without jamming an unrelated piston", () => {
    const world = new World(10, 7);
    const stack = placeUpStack(world, 1, 4, 3);
    world.setWeld(1, 4, 1, 5, true);
    world.setWeld(1, 5, 1, 6, true);
    const ceilingId = world.place(1, 1, TileKind.Platform);
    const freeStack = placeUpStack(world, 7, 6, 1);

    new Simulation(world).step();

    for (const [offset, { pistonId, sourceId }] of stack.entries()) {
      const baseY = offset === 0 ? 3 : offset === 1 ? 5 : 6;
      if (offset < 2) {
        expect(world.kindAt(1, baseY)).toBe(TileKind.PistonBase);
        expect(world.tileAt(1, baseY - 1)).toEqual({ kind: TileKind.PistonArm, id: pistonId });
        expect(world.isWelded(1, baseY, 1, baseY - 1)).toBe(true);
      } else {
        expect(world.tileAt(1, baseY)).toEqual({ kind: TileKind.Piston, id: pistonId });
      }
      expect(world.tileAt(2, baseY)).toEqual({ kind: TileKind.FixedCharge, id: sourceId });
      expect(world.isWelded(1, baseY, 2, baseY)).toBe(true);
    }
    expect(world.isWelded(1, 6, 1, 5)).toBe(true);
    expect(world.isWelded(1, 4, 1, 3)).toBe(true);
    expect(world.tileAt(1, 1)).toEqual({ kind: TileKind.Platform, id: ceilingId });
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

  it("extends and retracts a head-welded five-piston tower in single ticks in mirrored and reversed placement orders", () => {
    for (const direction of [Direction.Up, Direction.Right, Direction.Down, Direction.Left]) {
      const snapshots: string[] = [];
      for (const reversed of [false, true]) {
        const vertical = direction === Direction.Up || direction === Direction.Down;
        const world = new World(vertical ? 5 : 11, vertical ? 11 : 3);
        const point = (distance: number, side = 0): [number, number] => vertical
          ? [2 + side, direction === Direction.Up ? 10 - distance : distance]
          : [direction === Direction.Right ? distance : 10 - distance, 2 - side];
        const sourceDirection = vertical ? Direction.Left : Direction.Down;
        const order = [0, 1, 2, 3, 4];
        if (reversed) order.reverse();
        const stack = new Map<number, { pistonId: number; inverterId: number; sourceId: number }>();
        for (const offset of order) {
          const pistonId = world.place(...point(offset), TileKind.Piston, direction);
          const inverterId = world.place(...point(offset, 1), TileKind.Inverter, sourceDirection);
          const sourceId = world.place(...point(offset, 2), TileKind.FixedCharge);
          world.setWeld(...point(offset), ...point(offset, 1), true);
          world.setWeld(...point(offset, 1), ...point(offset, 2), true);
          // Gates observe old inputs: extend on this tick, retract on the next.
          world.setCharge(...point(offset, 2), -1);
          stack.set(offset, { pistonId, inverterId, sourceId });
        }
        const loadId = world.place(...point(5), TileKind.Stone);
        for (let offset = 0; offset < 5; offset += 1) {
          world.setWeld(...point(offset), ...point(offset + 1), true);
        }
        if (direction === Direction.Down) {
          world.place(1, 0, TileKind.Platform);
          world.setWeld(1, 0, 2, 0, true);
        }
        const before = geometry(world);
        const simulation = new Simulation(world);

        simulation.step();

        for (const [offset, { pistonId, inverterId, sourceId }] of stack) {
          const base = 2 * offset;
          expect(world.kindAt(...point(base))).toBe(TileKind.PistonBase);
          expect(world.orientationAt(...point(base))).toBe(direction);
          expect(world.chargeAt(...point(base))).toBe(1);
          expect(world.tileAt(...point(base + 1))).toEqual({ kind: TileKind.PistonArm, id: pistonId });
          expect(world.tileAt(...point(base, 1))).toEqual({ kind: TileKind.Inverter, id: inverterId });
          expect(world.tileAt(...point(base, 2))).toEqual({ kind: TileKind.FixedCharge, id: sourceId });
          expect(world.isWelded(...point(base), ...point(base + 1))).toBe(true);
          expect(world.isWelded(...point(base + 1), ...point(base + 2))).toBe(true);
          expect(world.isWelded(...point(base), ...point(base, 1))).toBe(true);
          expect(world.isWelded(...point(base, 1), ...point(base, 2))).toBe(true);
        }
        expect(world.tileAt(...point(10))).toEqual({ kind: TileKind.Stone, id: loadId });
        snapshots.push(JSON.stringify(geometry(world).map(({ id: _id, ...cell }) => cell)));

        simulation.step();

        expect(geometry(world)).toEqual(before);
        for (const offset of stack.keys()) {
          expect(world.chargeAt(...point(offset))).toBe(-1);
        }
      }
      // Placement changes allocated IDs, but not the resulting board geometry.
      expect(snapshots[0]).toEqual(snapshots[1]);
    }
  });

  it("retracts a distal head even when a blocked carried source prevents the remaining retractions", () => {
    const world = new World(5, 7);
    const stack = [2, 4, 6].map((y) => {
      const baseId = world.place(1, y, TileKind.PistonBase, Direction.Up);
      const armId = world.place(1, y - 1, TileKind.PistonArm, Direction.Up);
      const inverterId = world.place(2, y, TileKind.Inverter, Direction.Left);
      const sourceId = world.place(3, y, TileKind.FixedCharge);
      world.setWeld(1, y, 1, y - 1, true);
      world.setWeld(1, y, 2, y, true);
      world.setWeld(2, y, 3, y, true);
      world.setCharge(3, y, 1);
      return { y, baseId, armId, inverterId, sourceId };
    });
    const loadId = world.place(1, 0, TileKind.Stone);
    const blockerId = world.place(3, 3, TileKind.Platform);
    for (const y of [1, 3, 5]) {
      world.setWeld(1, y, 1, y - 1, true);
    }

    new Simulation(world).step();

    expect(world.tileAt(1, 0)).toEqual({ kind: TileKind.Empty, id: 0 });
    expect(world.tileAt(1, 1)).toEqual({ kind: TileKind.Stone, id: loadId });
    expect(world.tileAt(1, 2)).toEqual({ kind: TileKind.Piston, id: expectDefined(stack[0], "distal piston").armId });
    expect(world.isWelded(1, 2, 1, 1)).toBe(true);
    for (const { y, baseId, armId, inverterId, sourceId } of stack) {
      if (y !== 2) {
        expect(world.tileAt(1, y)).toEqual({ kind: TileKind.PistonBase, id: baseId });
        expect(world.tileAt(1, y - 1)).toEqual({ kind: TileKind.PistonArm, id: armId });
        expect(world.isWelded(1, y, 1, y - 1)).toBe(true);
        expect(world.isWelded(1, y - 1, 1, y - 2)).toBe(true);
      }
      expect(world.chargeAt(1, y)).toBe(-1);
      expect(world.tileAt(2, y)).toEqual({ kind: TileKind.Inverter, id: inverterId });
      expect(world.tileAt(3, y)).toEqual({ kind: TileKind.FixedCharge, id: sourceId });
      expect(world.isWelded(1, y, 2, y)).toBe(true);
      expect(world.isWelded(2, y, 3, y)).toBe(true);
    }
    expect(world.tileAt(3, 3)).toEqual({ kind: TileKind.Platform, id: blockerId });
  });

  it("extends and retracts parallel pistons welded to one beam without tearing its welds", () => {
    const world = new World(7, 5);
    for (const x of [2, 4]) {
      const side = x === 2 ? -1 : 1;
      world.place(x, 3, TileKind.Piston, Direction.Up);
      world.place(x, 4, TileKind.Platform);
      world.place(x + side, 3, TileKind.Inverter, side === -1 ? Direction.Right : Direction.Left);
      world.place(x + 2 * side, 3, TileKind.FixedCharge);
      world.setWeld(x, 3, x, 4, true);
      world.setWeld(x, 3, x + side, 3, true);
      world.setWeld(x + side, 3, x + 2 * side, 3, true);
      world.setCharge(x + 2 * side, 3, -1);
    }
    for (let x = 2; x <= 4; x += 1) world.place(x, 2, TileKind.Stone);
    world.setWeld(2, 2, 3, 2, true);
    world.setWeld(3, 2, 4, 2, true);
    world.setWeld(2, 3, 2, 2, true);
    world.setWeld(4, 3, 4, 2, true);
    const before = geometry(world);
    const simulation = new Simulation(world);

    simulation.step();

    for (const x of [2, 4]) {
      expect(world.kindAt(x, 3)).toBe(TileKind.PistonBase);
      expect(world.kindAt(x, 2)).toBe(TileKind.PistonArm);
      expect(world.isWelded(x, 2, x, 1)).toBe(true);
    }
    expect(world.kindAt(3, 1)).toBe(TileKind.Stone);
    expect(world.isWelded(2, 1, 3, 1)).toBe(true);
    expect(world.isWelded(3, 1, 4, 1)).toBe(true);

    simulation.step();

    expect(geometry(world)).toEqual(before);
  });

  it("recoils the upper opposing piston before the lower piston pushes it, extending both in one tick", () => {
    const world = new World(5, 6);
    const upperSourceId = world.place(2, 3, TileKind.FixedCharge);
    const upperId = world.place(2, 4, TileKind.Piston, Direction.Down);
    const lowerId = world.place(2, 5, TileKind.Piston, Direction.Up);
    const leftSourceId = world.place(1, 5, TileKind.FixedCharge);
    const rightSourceId = world.place(3, 5, TileKind.FixedCharge);
    world.setWeld(2, 3, 2, 4, true);
    world.setWeld(1, 5, 2, 5, true);
    world.setWeld(2, 5, 3, 5, true);

    new Simulation(world).step();

    expect(world.tileAt(2, 1)).toEqual({ kind: TileKind.FixedCharge, id: upperSourceId });
    expect(world.kindAt(2, 2)).toBe(TileKind.PistonBase);
    expect(world.orientationAt(2, 2)).toBe(Direction.Down);
    expect(world.tileAt(2, 3)).toEqual({ kind: TileKind.PistonArm, id: upperId });
    expect(world.tileAt(2, 4)).toEqual({ kind: TileKind.PistonArm, id: lowerId });
    expect(world.kindAt(2, 5)).toBe(TileKind.PistonBase);
    expect(world.orientationAt(2, 5)).toBe(Direction.Up);
    expect(world.tileAt(1, 5)).toEqual({ kind: TileKind.FixedCharge, id: leftSourceId });
    expect(world.tileAt(3, 5)).toEqual({ kind: TileKind.FixedCharge, id: rightSourceId });
    expect(world.isWelded(2, 1, 2, 2)).toBe(true);
    expect(world.isWelded(2, 2, 2, 3)).toBe(true);
    expect(world.isWelded(2, 4, 2, 5)).toBe(true);
    expect(world.isWelded(1, 5, 2, 5)).toBe(true);
    expect(world.isWelded(2, 5, 3, 5)).toBe(true);
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

  it("resolves boundary-blocked strokes by recoil without suppressing an independent opposing stroke", () => {
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
      expect(world.kindAt(x(9), 2)).toBe(TileKind.PistonBase);
      expect(world.tileAt(x(8), 2)).toEqual({ kind: TileKind.PistonArm, id: opposingId });
      expect(world.isWelded(x(9), 2, x(8), 2)).toBe(true);
      expect(world.isWelded(x(9), 2, x(9), 1)).toBe(true);
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
