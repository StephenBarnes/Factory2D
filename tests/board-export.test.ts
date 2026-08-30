import { describe, expect, it } from "vitest";

import { serializeBoard } from "../src/simulation/board-export";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("board export", () => {
  it("serializes tiles, orientations, and welds in grid order", () => {
    const world = new World(3, 2);
    world.place(2, 0, TileKind.Magnet, Direction.Left);
    world.place(0, 1, TileKind.Platform);
    world.place(1, 1, TileKind.Stone);
    world.setWeld(0, 1, 1, 1, true);

    expect(serializeBoard(world, 17)).toBe(`${JSON.stringify({
      format: "factory2d-board",
      version: 1,
      width: 3,
      height: 2,
      tick: 17,
      tiles: [
        { x: 2, y: 0, kind: "magnet", orientation: "left" },
        { x: 0, y: 1, kind: "platform", orientation: "up" },
        { x: 1, y: 1, kind: "stone", orientation: "up" },
      ],
      welds: [
        { x: 0, y: 1, direction: "right" },
      ],
    }, null, 2)}\n`);
  });

  it("exports an empty board without runtime tile identities", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Sand);
    world.place(0, 0, TileKind.Empty);

    expect(JSON.parse(serializeBoard(world, 0))).toEqual({
      format: "factory2d-board",
      version: 1,
      width: 2,
      height: 1,
      tick: 0,
      tiles: [],
      welds: [],
    });
  });

  it("rejects a tick that cannot identify a deterministic simulation state", () => {
    const world = new World(1, 1);

    expect(() => serializeBoard(world, -1)).toThrowError(
      "Board tick must be a non-negative integer",
    );
    expect(() => serializeBoard(world, 0.5)).toThrowError(
      "Board tick must be a non-negative integer",
    );
  });
});
