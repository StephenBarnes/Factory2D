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
    world.place(2, 1, TileKind.Conduit);
    world.setCharge(2, 1, -1);
    world.setWeld(0, 1, 1, 1, true);

    expect(serializeBoard(world, 17)).toBe(`${JSON.stringify({
      format: "factory2d-board",
      version: 2,
      width: 3,
      height: 2,
      tick: 17,
      tiles: [
        { x: 2, y: 0, kind: "magnet", orientation: "left" },
        { x: 0, y: 1, kind: "platform" },
        { x: 1, y: 1, kind: "stone" },
        { x: 2, y: 1, kind: "conduit", charge: -1 },
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
      version: 2,
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
      version: 2,
      width: 2,
      height: 3,
      tick: 42,
      tiles: [
        { x: 0, y: 0, kind: "magnet", orientation: "left" },
        { x: 1, y: 0, kind: "metal" },
        { x: 0, y: 1, kind: "sensor", orientation: "down", charge: 1 },
        { x: 1, y: 1, kind: "inverter", orientation: "right", charge: -1 },
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
    expect(imported.world.kindAt(0, 1)).toBe(TileKind.Sensor);
    expect(imported.world.orientationAt(0, 1)).toBe(Direction.Down);
    expect(imported.world.chargeAt(0, 1)).toBe(1);
    expect(imported.world.kindAt(1, 1)).toBe(TileKind.Inverter);
    expect(imported.world.orientationAt(1, 1)).toBe(Direction.Right);
    expect(imported.world.chargeAt(1, 1)).toBe(-1);
    expect(imported.world.orientationAt(1, 0)).toBe(Direction.Up);
    expect(imported.world.kindAt(1, 2)).toBe(TileKind.Sand);
    expect(imported.world.isWelded(0, 0, 1, 0)).toBe(true);
  });

  it("round-trips diode and sum rune state", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Diode, Direction.Right);
    world.place(1, 0, TileKind.Sum, Direction.Left);
    world.setCharge(0, 0, -1);
    world.setCharge(1, 0, 1);

    const imported = deserializeBoard(serializeBoard(world, 3));

    expect(imported.tick).toBe(3);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.Diode);
    expect(imported.world.orientationAt(0, 0)).toBe(Direction.Right);
    expect(imported.world.chargeAt(0, 0)).toBe(-1);
    expect(imported.world.kindAt(1, 0)).toBe(TileKind.Sum);
    expect(imported.world.orientationAt(1, 0)).toBe(Direction.Left);
    expect(imported.world.chargeAt(1, 0)).toBe(1);
  });

  it("rejects duplicate tiles without returning a partial world", () => {
    const source = JSON.stringify({
      format: "factory2d-board",
      version: 2,
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
      version: 2,
      width: 1,
      height: 1,
      tick: 0,
      tiles: [{ x: 0, y: 0, kind: "stone" }],
      welds: [{ x: 0, y: 0, direction: "right" }],
    });
    const incompatible = JSON.stringify({
      format: "factory2d-board",
      version: 2,
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

  it("rejects invalid charge values and charged non-circuit tiles", () => {
    const invalidValue = JSON.stringify({
      format: "factory2d-board",
      version: 2,
      width: 1,
      height: 1,
      tick: 0,
      tiles: [{ x: 0, y: 0, kind: "conduit", charge: 2 }],
      welds: [],
    });
    const invalidTile = JSON.stringify({
      format: "factory2d-board",
      version: 2,
      width: 1,
      height: 1,
      tick: 0,
      tiles: [{ x: 0, y: 0, kind: "stone", charge: 1 }],
      welds: [],
    });

    expect(() => deserializeBoard(invalidValue)).toThrowError(
      "Tile 0 charge must be an integer from -1 through 1",
    );
    expect(() => deserializeBoard(invalidTile)).toThrowError(
      "Only circuit-connected tiles can hold a nonzero charge",
    );
  });

});
