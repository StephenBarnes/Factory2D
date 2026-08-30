import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("board export", () => {
  it("serializes the tile grid and sparse state in grid order", () => {
    const world = new World(3, 2);
    world.place(2, 0, TileKind.Magnet, Direction.Left);
    world.place(0, 1, TileKind.Platform);
    world.place(1, 1, TileKind.Stone);
    world.place(2, 1, TileKind.Conduit);
    world.setCharge(2, 1, -1);
    world.setWeld(0, 1, 1, 1, true);
    world.setWeld(2, 0, 2, 1, true);

    expect(serializeBoard(world, 17)).toBe(`${JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 17,
      grid: [
        "..L",
        "=#C",
      ],
      orientations: [
        { x: 2, y: 0, direction: "left" },
      ],
      charges: [
        { x: 2, y: 1, charge: -1 },
      ],
      welds: [
        "..|",
        "-..",
      ],
    }, null, 2)}\n`);
  });

  it("exports an empty board without runtime tile identities", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Sand);
    world.place(0, 0, TileKind.Empty);

    expect(JSON.parse(serializeBoard(world, 0))).toEqual({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: [".."],
      orientations: [],
      charges: [],
      welds: [".."],
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

  it("imports grid dimensions, state, orientation, and welds", () => {
    const source = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 42,
      grid: [
        "LM",
        "SI",
        ".:",
      ],
      orientations: [
        { x: 0, y: 0, direction: "left" },
        { x: 0, y: 1, direction: "down" },
        { x: 1, y: 1, direction: "right" },
      ],
      charges: [
        { x: 0, y: 1, charge: 1 },
        { x: 1, y: 1, charge: -1 },
      ],
      welds: [
        "+.",
        "..",
        "..",
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
    expect(imported.world.isWelded(0, 0, 0, 1)).toBe(true);
  });

  it("round-trips combiner rune state", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Combiner, Direction.Right);
    world.setCharge(0, 0, -1);

    const imported = deserializeBoard(serializeBoard(world, 3));

    expect(imported.tick).toBe(3);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.Combiner);
    expect(imported.world.orientationAt(0, 0)).toBe(Direction.Right);
    expect(imported.world.chargeAt(0, 0)).toBe(-1);
  });

  it("rejects malformed grid rows and unknown tile codes", () => {
    const unevenRows = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: ["..", "."],
      orientations: [],
      charges: [],
      welds: ["..", ".."],
    });
    const unknownCode = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: ["?"],
      orientations: [],
      charges: [],
      welds: ["."],
    });

    expect(() => deserializeBoard(unevenRows)).toThrowError(
      "Board grid row 1 must contain exactly 2 cells",
    );
    expect(() => deserializeBoard(unknownCode)).toThrowError(
      'Board grid cell (0, 0) has unknown tile code "?"',
    );
  });

  it("rejects duplicate or inapplicable orientation state", () => {
    const duplicate = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: ["L"],
      orientations: [
        { x: 0, y: 0, direction: "right" },
        { x: 0, y: 0, direction: "left" },
      ],
      charges: [],
      welds: ["."],
    });
    const inapplicable = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: ["#"],
      orientations: [{ x: 0, y: 0, direction: "right" }],
      charges: [],
      welds: ["."],
    });

    expect(() => deserializeBoard(duplicate)).toThrowError(
      "Orientation 1 duplicates cell (0, 0)",
    );
    expect(() => deserializeBoard(inapplicable)).toThrowError(
      "Orientation 0 targets a non-directional tile",
    );
  });

  it("rejects malformed weld grids and welds that cannot be applied", () => {
    const wrongHeight = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: ["##", "##"],
      orientations: [],
      charges: [],
      welds: [".."],
    });
    const wrongWidth = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: ["##"],
      orientations: [],
      charges: [],
      welds: ["."],
    });
    const unknownCode = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: ["#"],
      orientations: [],
      charges: [],
      welds: ["?"],
    });
    const outside = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: ["#"],
      orientations: [],
      charges: [],
      welds: ["-"],
    });
    const incompatible = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: [":#"],
      orientations: [],
      charges: [],
      welds: ["-."],
    });

    expect(() => deserializeBoard(wrongHeight)).toThrowError(
      "Board weld grid must contain exactly 2 rows",
    );
    expect(() => deserializeBoard(wrongWidth)).toThrowError(
      "Board weld grid row 0 must contain exactly 2 cells",
    );
    expect(() => deserializeBoard(unknownCode)).toThrowError(
      'Board weld grid cell (0, 0) has unknown weld code "?"',
    );
    expect(() => deserializeBoard(outside)).toThrowError(
      "Board weld grid cell (0, 0) points right outside the board",
    );
    expect(() => deserializeBoard(incompatible)).toThrowError(
      "Board weld grid cell (0, 0) cannot weld right",
    );
  });

  it("rejects invalid charge values and charged non-circuit tiles", () => {
    const invalidValue = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: ["C"],
      orientations: [],
      charges: [{ x: 0, y: 0, charge: 2 }],
      welds: ["."],
    });
    const invalidTile = JSON.stringify({
      format: "factory2d-board",
      version: 4,
      tick: 0,
      grid: ["#"],
      orientations: [],
      charges: [{ x: 0, y: 0, charge: 1 }],
      welds: ["."],
    });

    expect(() => deserializeBoard(invalidValue)).toThrowError(
      "Charge 0 value must be an integer from -1 through 1",
    );
    expect(() => deserializeBoard(invalidTile)).toThrowError(
      "Only circuit-connected tiles can hold a nonzero charge",
    );
  });
});
