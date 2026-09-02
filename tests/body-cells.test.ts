import { describe, expect, it } from "vitest";

import { collectWorldBodies } from "../src/render/body-cells";
import { Direction, TileKind, WeldSide } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("world body collection", () => {
  it("groups cells by welds, marks unwelded seams, and reads circuit connections", () => {
    const world = new World(3, 2);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.Conduit);
    world.place(1, 1, TileKind.Stone, Direction.Left);
    world.place(2, 1, TileKind.Sand);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 1, 1, true);

    const bodies = collectWorldBodies(world);
    expect(bodies.map((body) => body.map((cell) => `${cell.x},${cell.y}`).sort())).toEqual([
      ["0,0", "1,0", "1,1"],
      ["2,1"],
    ]);
    const welded = bodies[0] ?? [];
    const conduit = welded.find((cell) => cell.kind === TileKind.Conduit);
    expect(conduit?.circuitConnections).toBe(1 << Direction.Left);
    expect(welded.find((cell) => cell.kind === TileKind.FixedCharge)?.circuitConnections).toBe(
      1 << Direction.Right,
    );
    const stone = welded.find((cell) => cell.kind === TileKind.Stone);
    expect(stone?.orientation).toBe(Direction.Left);
    expect(stone?.circuitConnections).toBe(WeldSide.None);
    expect(stone?.seamRight).toBe(false);
    expect(welded.every((cell) => !cell.seamRight && !cell.seamDown)).toBe(true);
  });

  it("flags seams between touching cells joined only through another weld path", () => {
    const world = new World(2, 2);
    world.place(0, 0, TileKind.Stone);
    world.place(1, 0, TileKind.Stone);
    world.place(0, 1, TileKind.Stone);
    world.place(1, 1, TileKind.Stone);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 1, 1, true);
    world.setWeld(1, 1, 0, 1, true);

    const bodies = collectWorldBodies(world);
    expect(bodies).toHaveLength(1);
    const topLeft = bodies[0]?.find((cell) => cell.x === 0 && cell.y === 0);
    expect(topLeft?.seamRight).toBe(false);
    expect(topLeft?.seamDown).toBe(true);
    expect(collectWorldBodies(new World(2, 2))).toEqual([]);
  });
});
