import { describe, expect, it } from "vitest";

import { Simulation } from "../src/simulation/simulation";

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
      version: 11,
      width: 3,
      height: 2,
      tick: 17,
      result: "in-progress",
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
      crossingCharges: [],
      isolatedOutputCharges: [],
      furnaces: [],
      components: [],
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
      version: 11,
      width: 2,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: [".."],
      orientations: [],
      charges: [],
      crossingCharges: [],
      isolatedOutputCharges: [],
      furnaces: [],
      components: [],
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

  it("requires explicit dimensions from 1x1 through 400x300", () => {
    const maximum = deserializeBoard(serializeBoard(new World(400, 300), 0));
    expect([maximum.world.width, maximum.world.height]).toEqual([400, 300]);

    expect(() => serializeBoard(new World(401, 1), 0)).toThrowError(
      "Board width must be an integer from 1 through 400",
    );
    expect(() => serializeBoard(new World(1, 301), 0)).toThrowError(
      "Board height must be an integer from 1 through 300",
    );

    const board = JSON.parse(serializeBoard(new World(2, 2), 0)) as Record<string, unknown>;
    board.width = 0;
    expect(() => deserializeBoard(JSON.stringify(board))).toThrowError(
      "Board width must be an integer from 1 through 400",
    );
    board.width = 2;
    board.height = 301;
    expect(() => deserializeBoard(JSON.stringify(board))).toThrowError(
      "Board height must be an integer from 1 through 300",
    );
    board.height = 3;
    expect(() => deserializeBoard(JSON.stringify(board))).toThrowError(
      "Board grid must contain exactly 3 rows",
    );
    board.height = 2;
    board.width = 3;
    expect(() => deserializeBoard(JSON.stringify(board))).toThrowError(
      "Board grid row 0 must contain exactly 3 cells",
    );
  });

  it("rejects an unknown puzzle result", () => {
    const board = JSON.parse(serializeBoard(new World(1, 1), 0)) as Record<string, unknown>;
    board.result = "draw";

    expect(() => deserializeBoard(JSON.stringify(board))).toThrowError(
      'Board result must be "in-progress", "won", or "lost"',
    );
  });

  it("rejects unknown board and state fields", () => {
    const board = JSON.parse(serializeBoard(new World(1, 1), 0)) as Record<string, unknown>;
    board.unexpected = true;
    expect(() => deserializeBoard(JSON.stringify(board))).toThrowError(
      'Board has unknown field "unexpected"',
    );

    delete board.unexpected;
    board.grid = ["S"];
    board.orientations = [{ x: 0, y: 0, direction: "right", unexpected: true }];
    expect(() => deserializeBoard(JSON.stringify(board))).toThrowError(
      'Orientation 0 has unknown field "unexpected"',
    );
  });

  it("imports grid dimensions, state, orientation, and welds", () => {
    const source = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 2,
      height: 3,
      tick: 42,
      result: "in-progress",
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
      crossingCharges: [],
      furnaces: [],
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
    expect(imported.world.kindAt(1, 0)).toBe(TileKind.Iron);
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

  it.each([
    { kind: TileKind.Combiner, code: "+" },
    { kind: TileKind.Rectifier, code: "R" },
    { kind: TileKind.Multiplier, code: "*" },
    { kind: TileKind.Subtractor, code: "-" },
    { kind: TileKind.ChargeSensor, code: "Q" },
    { kind: TileKind.Selector, code: "T" },
  ])("round-trips directional gate $kind with code $code", ({ kind, code }) => {
    const world = new World(1, 1);
    world.place(0, 0, kind, Direction.Right);
    world.setCharge(0, 0, -1);

    const serialized = serializeBoard(world, 3);
    const imported = deserializeBoard(serialized);

    expect(JSON.parse(serialized).grid).toEqual([code]);
    expect(imported.tick).toBe(3);
    expect(imported.world.kindAt(0, 0)).toBe(kind);
    expect(imported.world.orientationAt(0, 0)).toBe(Direction.Right);
    expect(imported.world.chargeAt(0, 0)).toBe(-1);
  });

  it("round-trips a fixed charge rune with its compact code", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.FixedCharge);

    const serialized = serializeBoard(world, 3);
    const imported = deserializeBoard(serialized);

    expect(JSON.parse(serialized).grid).toEqual(["1"]);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.FixedCharge);
  });

  it("round-trips a spark rune with its compact code", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Spark);

    const serialized = serializeBoard(world, 1);
    const imported = deserializeBoard(serialized);

    expect(JSON.parse(serialized).grid).toEqual(["K"]);
    expect(imported.tick).toBe(1);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.Spark);
  });

  it("round-trips independent wire crossing axis charges", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.WireCrossing);
    world.setCrossingCharges(0, 0, 1, -1);

    const serialized = serializeBoard(world, 7);
    const imported = deserializeBoard(serialized);

    expect(JSON.parse(serialized)).toMatchObject({
      version: 11,
      width: 1,
      height: 1,
      grid: ["W"],
      charges: [],
      crossingCharges: [{ x: 0, y: 0, horizontal: 1, vertical: -1 }],
      furnaces: [],
    });
    expect(imported.tick).toBe(7);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.WireCrossing);
    expect(imported.world.chargeAtPort(0, 0, Direction.Left)).toBe(1);
    expect(imported.world.chargeAtPort(0, 0, Direction.Up)).toBe(-1);
  });

  it("round-trips active furnace progress without runtime target IDs", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    world.place(1, 0, TileKind.Sand);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();

    const serialized = serializeBoard(world, 2);
    const imported = deserializeBoard(serialized);

    expect(JSON.parse(serialized)).toMatchObject({
      version: 11,
      width: 2,
      height: 1,
      grid: ["F:"],
      orientations: [{ x: 0, y: 0, direction: "right" }],
      furnaces: [{ x: 0, y: 0, progress: 2 }],
    });
    expect(imported.world.furnaceProgressAt(0, 0)).toBe(2);

    const importedSimulation = new Simulation(imported.world);
    importedSimulation.step();
    importedSimulation.step();
    expect(imported.world.kindAt(1, 0)).toBe(TileKind.Glass);
  });

  it("round-trips configurable component state and rejects missing state", () => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.Delay, Direction.Right);
    world.place(1, 0, TileKind.Counter, Direction.Down);
    world.place(2, 0, TileKind.Rom, Direction.Left);
    world.restoreComponentState(0, 0, {
      type: "delay",
      length: 3,
      cursor: 2,
      data: [1, 0, -1],
    });
    world.restoreComponentState(1, 0, {
      type: "counter",
      threshold: 5,
      count: 3,
    });
    world.restoreComponentState(2, 0, {
      type: "rom",
      width: 2,
      height: 2,
      cursor: 2,
      values: [0, 1, -1, 1],
    });

    const serialized = serializeBoard(world, 12);
    const parsed = JSON.parse(serialized) as {
      components: unknown[];
    };
    expect(parsed.components).toEqual([
      { x: 0, y: 0, type: "delay", length: 3, cursor: 2, data: [1, 0, -1] },
      { x: 1, y: 0, type: "counter", threshold: 5, count: 3 },
      {
        x: 2,
        y: 0,
        type: "rom",
        width: 2,
        height: 2,
        cursor: 2,
        values: [0, 1, -1, 1],
      },
    ]);

    const imported = deserializeBoard(serialized);
    expect(imported.world.componentStateSnapshotAt(0, 0)).toEqual({
      type: "delay",
      length: 3,
      cursor: 2,
      data: [1, 0, -1],
    });
    expect(imported.world.componentStateSnapshotAt(1, 0)).toEqual({
      type: "counter",
      threshold: 5,
      count: 3,
    });
    expect(imported.world.componentStateSnapshotAt(2, 0)).toEqual({
      type: "rom",
      width: 2,
      height: 2,
      cursor: 2,
      values: [0, 1, -1, 1],
    });

    parsed.components = [];
    expect(() => deserializeBoard(JSON.stringify(parsed))).toThrowError(
      "Configurable component at (0, 0) is missing state",
    );
  });

  it("rejects furnace progress without a valid in-progress recipe", () => {
    const base = {
      format: "factory2d-board",
      version: 11,
      width: 2,
      height: 1,
      tick: 0,
      result: "in-progress",
      orientations: [{ x: 0, y: 0, direction: "right" }],
      charges: [],
      crossingCharges: [],
      welds: [".."],
    };

    expect(() => deserializeBoard(JSON.stringify({
      ...base,
      grid: ["F#"],
      furnaces: [{ x: 0, y: 0, progress: 1 }],
    }))).toThrowError("Furnace 0 has no bakeable target");
    expect(() => deserializeBoard(JSON.stringify({
      ...base,
      grid: ["F:"],
      furnaces: [{ x: 0, y: 0, progress: 4 }],
    }))).toThrowError("Furnace 0 progress must be an integer from 1 through 3");
  });

  it("rejects malformed grid rows and unknown tile codes", () => {
    const unevenRows = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 2,
      height: 2,
      tick: 0,
      result: "in-progress",
      grid: ["..", "."],
      orientations: [],
      charges: [],
      crossingCharges: [],
      furnaces: [],
      welds: ["..", ".."],
    });
    const unknownCode = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 1,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: ["?"],
      orientations: [],
      charges: [],
      crossingCharges: [],
      furnaces: [],
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
      version: 11,
      width: 1,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: ["L"],
      orientations: [
        { x: 0, y: 0, direction: "right" },
        { x: 0, y: 0, direction: "left" },
      ],
      charges: [],
      crossingCharges: [],
      furnaces: [],
      welds: ["."],
    });
    const inapplicable = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 1,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: ["#"],
      orientations: [{ x: 0, y: 0, direction: "right" }],
      charges: [],
      crossingCharges: [],
      furnaces: [],
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
      version: 11,
      width: 2,
      height: 2,
      tick: 0,
      result: "in-progress",
      grid: ["##", "##"],
      orientations: [],
      charges: [],
      crossingCharges: [],
      furnaces: [],
      welds: [".."],
    });
    const wrongWidth = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 2,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: ["##"],
      orientations: [],
      charges: [],
      crossingCharges: [],
      furnaces: [],
      welds: ["."],
    });
    const unknownCode = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 1,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: ["#"],
      orientations: [],
      charges: [],
      crossingCharges: [],
      furnaces: [],
      welds: ["?"],
    });
    const outside = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 1,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: ["#"],
      orientations: [],
      charges: [],
      crossingCharges: [],
      furnaces: [],
      welds: ["-"],
    });
    const incompatible = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 2,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: [":#"],
      orientations: [],
      charges: [],
      crossingCharges: [],
      furnaces: [],
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

  it("rejects crossing charge state on the wrong tile or with no charge", () => {
    const wrongTile = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 1,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: ["C"],
      orientations: [],
      charges: [],
      crossingCharges: [{ x: 0, y: 0, horizontal: 1, vertical: 0 }],
      furnaces: [],
      welds: ["."],
    });
    const neutralCrossing = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 1,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: ["W"],
      orientations: [],
      charges: [],
      crossingCharges: [{ x: 0, y: 0, horizontal: 0, vertical: 0 }],
      furnaces: [],
      welds: ["."],
    });

    expect(() => deserializeBoard(wrongTile)).toThrowError(
      "Crossing charge 0 targets a non-crossing tile",
    );
    expect(() => deserializeBoard(neutralCrossing)).toThrowError(
      "Crossing charge 0 must contain a nonzero charge",
    );
  });

  it("rejects invalid charge values and charged non-circuit tiles", () => {
    const invalidValue = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 1,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: ["C"],
      orientations: [],
      charges: [{ x: 0, y: 0, charge: 2 }],
      crossingCharges: [],
      furnaces: [],
      welds: ["."],
    });
    const invalidTile = JSON.stringify({
      format: "factory2d-board",
      version: 11,
      width: 1,
      height: 1,
      tick: 0,
      result: "in-progress",
      grid: ["#"],
      orientations: [],
      charges: [{ x: 0, y: 0, charge: 1 }],
      crossingCharges: [],
      furnaces: [],
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
