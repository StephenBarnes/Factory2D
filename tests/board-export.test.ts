import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
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
        { x: 0, y: 1, kind: "platform" },
        { x: 1, y: 1, kind: "stone" },
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

  it("imports exported dimensions, state, orientation, and welds", () => {
    const source = JSON.stringify({
      format: "factory2d-board",
      version: 1,
      width: 2,
      height: 3,
      tick: 42,
      tiles: [
        { x: 0, y: 0, kind: "magnet", orientation: "left" },
        { x: 1, y: 0, kind: "metal" },
        { x: 1, y: 2, kind: "sand" },
      ],
      welds: [
        { x: 0, y: 0, direction: "right" },
      ],
    });

    const imported = deserializeBoard(source);

    expect(imported.tick).toBe(42);
    expect(imported.world.width).toBe(2);
    expect(imported.world.height).toBe(3);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.Magnet);
    expect(imported.world.orientationAt(0, 0)).toBe(Direction.Left);
    expect(imported.world.kindAt(1, 0)).toBe(TileKind.Metal);
    expect(imported.world.orientationAt(1, 0)).toBe(Direction.Up);
    expect(imported.world.kindAt(1, 2)).toBe(TileKind.Sand);
    expect(imported.world.isWelded(0, 0, 1, 0)).toBe(true);
  });

  it("rejects duplicate tiles without returning a partial world", () => {
    const source = JSON.stringify({
      format: "factory2d-board",
      version: 1,
      width: 1,
      height: 1,
      tick: 0,
      tiles: [
        { x: 0, y: 0, kind: "stone" },
        { x: 0, y: 0, kind: "metal" },
      ],
      welds: [],
    });

    expect(() => deserializeBoard(source)).toThrowError(
      "Tile 1 duplicates cell (0, 0)",
    );
  });

  it("rejects welds that point outside the board or join incompatible tiles", () => {
    const outside = JSON.stringify({
      format: "factory2d-board",
      version: 1,
      width: 1,
      height: 1,
      tick: 0,
      tiles: [{ x: 0, y: 0, kind: "stone" }],
      welds: [{ x: 0, y: 0, direction: "right" }],
    });
    const incompatible = JSON.stringify({
      format: "factory2d-board",
      version: 1,
      width: 2,
      height: 1,
      tick: 0,
      tiles: [
        { x: 0, y: 0, kind: "sand" },
        { x: 1, y: 0, kind: "stone" },
      ],
      welds: [{ x: 0, y: 0, direction: "right" }],
    });

    expect(() => deserializeBoard(outside)).toThrowError(
      "Weld 0 points outside the board",
    );
    expect(() => deserializeBoard(incompatible)).toThrowError(
      "Weld 0 cannot join its two cells",
    );
  });
});
