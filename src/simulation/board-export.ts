import type { Charge } from "./circuit";
import { Direction, TILE_DEFINITIONS, TileKind } from "./tile";
import { World } from "./world";
import { expectDefined } from "../util/assert";

const FORMAT_NAME = "factory2d-board";
const FORMAT_VERSION = 3;
const MAX_BOARD_WIDTH = 400;
const MAX_BOARD_HEIGHT = 300;

// TODO refactor this to move these tile codes to the single TILE_DEFINITIONS in
// tile.ts. We want to avoid having to edit multiple different files every time
// we add a new tile type. Build the TILE_KINDS_BY_CODE programatically.
// Maybe move TILE_DEFINITIONS out of `simulation/` since they're also used by
// rendering and board export, e.g. to a `registry.ts`.

const TILE_CODES: Readonly<Record<TileKind, string>> = {
  [TileKind.Empty]: ".",
  [TileKind.Stone]: "#",
  [TileKind.Sand]: ":",
  [TileKind.Platform]: "=",
  [TileKind.Magnet]: "L",
  [TileKind.Metal]: "M",
  [TileKind.Conduit]: "C",
  [TileKind.Sensor]: "S",
  [TileKind.Inverter]: "I",
  [TileKind.Combiner]: "+",
};

const TILE_KINDS_BY_CODE: Readonly<Record<string, TileKind | undefined>> = {
  ".": TileKind.Empty,
  "#": TileKind.Stone,
  ":": TileKind.Sand,
  "=": TileKind.Platform,
  L: TileKind.Magnet,
  M: TileKind.Metal,
  C: TileKind.Conduit,
  S: TileKind.Sensor,
  I: TileKind.Inverter,
  "+": TileKind.Combiner,
};

const DIRECTION_NAMES: Readonly<Record<Direction, string>> = {
  [Direction.Up]: "up",
  [Direction.Right]: "right",
  [Direction.Down]: "down",
  [Direction.Left]: "left",
};

const DIRECTIONS_BY_NAME: Readonly<Record<string, Direction | undefined>> = {
  up: Direction.Up,
  right: Direction.Right,
  down: Direction.Down,
  left: Direction.Left,
};

interface ExportedOrientation {
  readonly x: number;
  readonly y: number;
  readonly direction: string;
}

interface ExportedCharge {
  readonly x: number;
  readonly y: number;
  readonly charge: -1 | 1;
}

interface ExportedWeld {
  readonly x: number;
  readonly y: number;
  readonly direction: "right" | "down";
}

interface ExportedBoard {
  readonly format: typeof FORMAT_NAME;
  readonly version: typeof FORMAT_VERSION;
  readonly tick: number;
  readonly grid: readonly string[];
  readonly orientations: readonly ExportedOrientation[];
  readonly charges: readonly ExportedCharge[];
  readonly welds: readonly ExportedWeld[];
}

export interface ImportedBoard {
  readonly world: World;
  readonly tick: number;
}

export function serializeBoard(world: World, tick: number): string {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError("Board tick must be a non-negative integer");
  }

  const grid: string[] = [];
  const orientations: ExportedOrientation[] = [];
  const charges: ExportedCharge[] = [];
  const welds: ExportedWeld[] = [];

  for (let y = 0; y < world.height; y += 1) {
    let row = "";
    for (let x = 0; x < world.width; x += 1) {
      const kind = world.kindAt(x, y);
      row += TILE_CODES[kind];
      if (kind === TileKind.Empty) {
        continue;
      }

      const orientation = world.orientationAt(x, y);
      if (orientation !== Direction.Up) {
        orientations.push({ x, y, direction: DIRECTION_NAMES[orientation] });
      }

      const charge = world.chargeAt(x, y);
      if (charge !== 0) {
        charges.push({ x, y, charge });
      }

      if (x + 1 < world.width && world.isWelded(x, y, x + 1, y)) {
        welds.push({ x, y, direction: "right" });
      }
      if (y + 1 < world.height && world.isWelded(x, y, x, y + 1)) {
        welds.push({ x, y, direction: "down" });
      }
    }
    grid.push(row);
  }

  const board: ExportedBoard = {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    tick,
    grid,
    orientations,
    charges,
    welds,
  };
  return `${JSON.stringify(board, null, 2)}\n`;
}

export function deserializeBoard(source: string): ImportedBoard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error("Board file is not valid JSON");
  }

  const board = requireObject(parsed, "Board");
  if (board.format !== FORMAT_NAME) {
    throw new Error(`Board format must be "${FORMAT_NAME}"`);
  }
  if (board.version !== FORMAT_VERSION) {
    throw new Error(`Board version must be ${FORMAT_VERSION}`);
  }

  const tick = requireInteger(board.tick, "Board tick", 0, Number.MAX_SAFE_INTEGER);
  const grid = requireArray(board.grid, "Board grid");
  requireInteger(grid.length, "Board grid height", 1, MAX_BOARD_HEIGHT);

  const firstRow = requireString(grid[0], "Board grid row 0");
  const width = requireInteger(firstRow.length, "Board grid width", 1, MAX_BOARD_WIDTH);
  const height = grid.length;
  const kinds = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const row = requireString(grid[y], `Board grid row ${y}`);
    if (row.length !== width) {
      throw new Error(`Board grid row ${y} must contain exactly ${width} cells`);
    }

    for (let x = 0; x < width; x += 1) {
      const code = expectDefined(row[x], `tile code at (${x}, ${y})`);
      const kind = TILE_KINDS_BY_CODE[code];
      if (kind === undefined) {
        throw new Error(`Board grid cell (${x}, ${y}) has unknown tile code "${code}"`);
      }
      kinds[y * width + x] = kind;
    }
  }

  const orientations = requireArray(board.orientations, "Board orientations");
  const orientationByCell = new Uint8Array(width * height);
  const hasOrientation = new Uint8Array(width * height);
  for (let index = 0; index < orientations.length; index += 1) {
    const state = requireObject(orientations[index], `Orientation ${index}`);
    const x = requireInteger(state.x, `Orientation ${index} x`, 0, width - 1);
    const y = requireInteger(state.y, `Orientation ${index} y`, 0, height - 1);
    const cellIndex = y * width + x;
    if (hasOrientation[cellIndex] === 1) {
      throw new Error(`Orientation ${index} duplicates cell (${x}, ${y})`);
    }

    const kind = expectDefined(kinds[cellIndex], `tile kind at (${x}, ${y})`) as TileKind;
    if (kind === TileKind.Empty || !TILE_DEFINITIONS[kind].usesOrientation) {
      throw new Error(`Orientation ${index} targets a non-directional tile`);
    }
    const directionName = requireString(state.direction, `Orientation ${index} direction`);
    const direction = DIRECTIONS_BY_NAME[directionName];
    if (direction === undefined) {
      throw new Error(`Orientation ${index} has unknown direction "${directionName}"`);
    }
    orientationByCell[cellIndex] = direction;
    hasOrientation[cellIndex] = 1;
  }

  const charges = requireArray(board.charges, "Board charges");
  const chargeByCell = new Int8Array(width * height);
  const hasCharge = new Uint8Array(width * height);
  for (let index = 0; index < charges.length; index += 1) {
    const state = requireObject(charges[index], `Charge ${index}`);
    const x = requireInteger(state.x, `Charge ${index} x`, 0, width - 1);
    const y = requireInteger(state.y, `Charge ${index} y`, 0, height - 1);
    const cellIndex = y * width + x;
    if (hasCharge[cellIndex] === 1) {
      throw new Error(`Charge ${index} duplicates cell (${x}, ${y})`);
    }

    const charge = requireInteger(state.charge, `Charge ${index} value`, -1, 1) as Charge;
    if (charge === 0) {
      throw new Error(`Charge ${index} value must be -1 or 1`);
    }
    chargeByCell[cellIndex] = charge;
    hasCharge[cellIndex] = 1;
  }

  const world = new World(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cellIndex = y * width + x;
      const kind = expectDefined(kinds[cellIndex], `tile kind at (${x}, ${y})`) as TileKind;
      if (kind === TileKind.Empty) {
        continue;
      }
      const orientation = expectDefined(
        orientationByCell[cellIndex],
        `tile orientation at (${x}, ${y})`,
      ) as Direction;
      world.place(x, y, kind, orientation);
      if (hasCharge[cellIndex] === 1) {
        const charge = expectDefined(
          chargeByCell[cellIndex],
          `tile charge at (${x}, ${y})`,
        ) as Charge;
        world.setCharge(x, y, charge);
      }
    }
  }

  const welds = requireArray(board.welds, "Board welds");
  const weldDirectionsByCell = new Uint8Array(width * height);
  for (let index = 0; index < welds.length; index += 1) {
    const weld = requireObject(welds[index], `Weld ${index}`);
    const x = requireInteger(weld.x, `Weld ${index} x`, 0, width - 1);
    const y = requireInteger(weld.y, `Weld ${index} y`, 0, height - 1);
    const direction = requireString(weld.direction, `Weld ${index} direction`);
    if (direction !== "right" && direction !== "down") {
      throw new Error(`Weld ${index} direction must be "right" or "down"`);
    }

    const directionBit = direction === "right" ? 1 : 2;
    const cellIndex = y * width + x;
    const existingDirections = expectDefined(
      weldDirectionsByCell[cellIndex],
      `weld directions at (${x}, ${y})`,
    );
    if ((existingDirections & directionBit) !== 0) {
      throw new Error(`Weld ${index} duplicates the ${direction} edge at (${x}, ${y})`);
    }
    weldDirectionsByCell[cellIndex] = existingDirections | directionBit;

    const neighborX = direction === "right" ? x + 1 : x;
    const neighborY = direction === "down" ? y + 1 : y;
    if (neighborX >= width || neighborY >= height) {
      throw new Error(`Weld ${index} points outside the board`);
    }
    if (!world.setWeld(x, y, neighborX, neighborY, true)) {
      throw new Error(`Weld ${index} cannot join its two cells`);
    }
  }

  return { world, tick };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function requireInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}
