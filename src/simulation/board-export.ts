import { furnaceRecipeFor } from "./furnace";
import type { Charge } from "./circuit";
import { PuzzleResult } from "./puzzle-result";
import {
  Direction,
  directionX,
  directionY,
  TILE_DEFINITIONS,
  TILE_KINDS,
  TileKind,
} from "./tile";
import { World } from "./world";
import { expectDefined } from "../util/assert";

const FORMAT_NAME = "factory2d-board";
const FORMAT_VERSION = 9;
export const MIN_BOARD_WIDTH = 1;
export const MAX_BOARD_WIDTH = 400;
export const MIN_BOARD_HEIGHT = 1;
export const MAX_BOARD_HEIGHT = 300;

function buildTileKindsByCode(): Readonly<Record<string, TileKind | undefined>> {
  const kindsByCode = Object.create(null) as Record<string, TileKind | undefined>;
  for (const kind of TILE_KINDS) {
    const definition = TILE_DEFINITIONS[kind];
    if (definition.boardCode.length !== 1) {
      throw new Error(`Board code for ${definition.name} must be one character`);
    }
    if (Object.hasOwn(kindsByCode, definition.boardCode)) {
      throw new Error(`Duplicate board tile code "${definition.boardCode}"`);
    }
    kindsByCode[definition.boardCode] = kind;
  }
  return kindsByCode;
}

const TILE_KINDS_BY_CODE = buildTileKindsByCode();

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

const PUZZLE_RESULT_NAMES: Readonly<Record<PuzzleResult, string>> = {
  [PuzzleResult.Lost]: "lost",
  [PuzzleResult.InProgress]: "in-progress",
  [PuzzleResult.Won]: "won",
};

const PUZZLE_RESULTS_BY_NAME: Readonly<Record<string, PuzzleResult | undefined>> = {
  lost: PuzzleResult.Lost,
  "in-progress": PuzzleResult.InProgress,
  won: PuzzleResult.Won,
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

interface ExportedCrossingCharge {
  readonly x: number;
  readonly y: number;
  readonly horizontal: Charge;
  readonly vertical: Charge;
}

interface ExportedFurnace {
  readonly x: number;
  readonly y: number;
  readonly progress: number;
}

interface ExportedBoard {
  readonly format: typeof FORMAT_NAME;
  readonly version: typeof FORMAT_VERSION;
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly result: string;
  readonly grid: readonly string[];
  readonly orientations: readonly ExportedOrientation[];
  readonly charges: readonly ExportedCharge[];
  readonly crossingCharges: readonly ExportedCrossingCharge[];
  readonly furnaces: readonly ExportedFurnace[];
  readonly welds: readonly string[];
}

export interface ImportedBoard {
  readonly world: World;
  readonly tick: number;
}

export function serializeBoard(world: World, tick: number): string {
  requireInteger(world.width, "Board width", MIN_BOARD_WIDTH, MAX_BOARD_WIDTH);
  requireInteger(world.height, "Board height", MIN_BOARD_HEIGHT, MAX_BOARD_HEIGHT);

  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError("Board tick must be a non-negative integer");
  }

  const grid: string[] = [];
  const orientations: ExportedOrientation[] = [];
  const charges: ExportedCharge[] = [];
  const crossingCharges: ExportedCrossingCharge[] = [];
  const furnaces: ExportedFurnace[] = [];
  const welds: string[] = [];

  for (let y = 0; y < world.height; y += 1) {
    let row = "";
    let weldRow = "";
    for (let x = 0; x < world.width; x += 1) {
      const kind = world.kindAt(x, y);
      row += TILE_DEFINITIONS[kind].boardCode;
      const hasRightWeld = x + 1 < world.width && world.isWelded(x, y, x + 1, y);
      const hasDownWeld = y + 1 < world.height && world.isWelded(x, y, x, y + 1);
      weldRow += hasDownWeld ? (hasRightWeld ? "+" : "|") : hasRightWeld ? "-" : ".";
      if (kind === TileKind.Empty) {
        continue;
      }

      const orientation = world.orientationAt(x, y);
      if (orientation !== Direction.Up) {
        orientations.push({ x, y, direction: DIRECTION_NAMES[orientation] });
      }

      if (kind === TileKind.WireCrossing) {
        const horizontal = world.chargeAtPort(x, y, Direction.Left);
        const vertical = world.chargeAtPort(x, y, Direction.Up);
        if (horizontal !== 0 || vertical !== 0) {
          crossingCharges.push({ x, y, horizontal, vertical });
        }
      } else {
        const charge = world.chargeAt(x, y);
        if (charge !== 0) {
          charges.push({ x, y, charge });
        }
      }
      if (kind === TileKind.Furnace) {
        const progress = world.furnaceProgressAt(x, y);
        const targetX = x + directionX(orientation);
        const targetY = y + directionY(orientation);
        const cellIndex = y * world.width + x;
        if (
          progress > 0 &&
          targetX >= 0 &&
          targetX < world.width &&
          targetY >= 0 &&
          targetY < world.height &&
          world.idAt(targetX, targetY) === world.furnaceTargetIdAtIndex(cellIndex)
        ) {
          furnaces.push({ x, y, progress });
        }
      }

    }
    grid.push(row);
    welds.push(weldRow);
  }

  const board: ExportedBoard = {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    width: world.width,
    height: world.height,
    tick,
    result: PUZZLE_RESULT_NAMES[world.puzzleResult],
    grid,
    orientations,
    charges,
    crossingCharges,
    furnaces,
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
  return deserializeBoardValue(parsed);
}

export function deserializeBoardValue(value: unknown): ImportedBoard {
  const board = requireObject(value, "Board", [
    "format",
    "version",
    "tick",
    "result",
    "width",
    "height",
    "grid",
    "orientations",
    "charges",
    "crossingCharges",
    "furnaces",
    "welds",
  ]);
  if (board.format !== FORMAT_NAME) {
    throw new Error(`Board format must be "${FORMAT_NAME}"`);
  }
  if (board.version !== FORMAT_VERSION) {
    throw new Error(`Board version must be ${FORMAT_VERSION}`);
  }

  const tick = requireInteger(board.tick, "Board tick", 0, Number.MAX_SAFE_INTEGER);
  const resultName = requireString(board.result, "Board result");
  const result = PUZZLE_RESULTS_BY_NAME[resultName];
  if (result === undefined) {
    throw new Error(`Board result must be \"in-progress\", \"won\", or \"lost\"`);
  }
  const width = requireInteger(
    board.width,
    "Board width",
    MIN_BOARD_WIDTH,
    MAX_BOARD_WIDTH,
  );
  const height = requireInteger(
    board.height,
    "Board height",
    MIN_BOARD_HEIGHT,
    MAX_BOARD_HEIGHT,
  );
  const grid = requireArray(board.grid, "Board grid");
  if (grid.length !== height) {
    throw new Error(`Board grid must contain exactly ${height} rows`);
  }

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
    const state = requireObject(orientations[index], `Orientation ${index}`, [
      "x",
      "y",
      "direction",
    ]);
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

  const furnaces = requireArray(board.furnaces, "Board furnaces");
  const furnaceProgressByCell = new Uint16Array(width * height);
  const hasFurnaceState = new Uint8Array(width * height);
  for (let index = 0; index < furnaces.length; index += 1) {
    const state = requireObject(furnaces[index], `Furnace ${index}`, [
      "x",
      "y",
      "progress",
    ]);
    const x = requireInteger(state.x, `Furnace ${index} x`, 0, width - 1);
    const y = requireInteger(state.y, `Furnace ${index} y`, 0, height - 1);
    const cellIndex = y * width + x;
    if (hasFurnaceState[cellIndex] === 1) {
      throw new Error(`Furnace ${index} duplicates cell (${x}, ${y})`);
    }
    if (kinds[cellIndex] !== TileKind.Furnace) {
      throw new Error(`Furnace ${index} targets a non-furnace tile`);
    }
    const orientation = expectDefined(
      orientationByCell[cellIndex],
      `furnace orientation at (${x}, ${y})`,
    ) as Direction;
    const targetX = x + directionX(orientation);
    const targetY = y + directionY(orientation);
    if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) {
      throw new Error(`Furnace ${index} points outside the board`);
    }
    const targetIndex = targetY * width + targetX;
    const targetKind = expectDefined(
      kinds[targetIndex],
      `furnace target kind at (${targetX}, ${targetY})`,
    ) as TileKind;
    const recipe = furnaceRecipeFor(targetKind);
    if (recipe === undefined) {
      throw new Error(`Furnace ${index} has no bakeable target`);
    }
    furnaceProgressByCell[cellIndex] = requireInteger(
      state.progress,
      `Furnace ${index} progress`,
      1,
      recipe.bakeTime - 1,
    );
    hasFurnaceState[cellIndex] = 1;
  }

  const charges = requireArray(board.charges, "Board charges");
  const chargeByCell = new Int8Array(width * height);
  const hasCharge = new Uint8Array(width * height);
  for (let index = 0; index < charges.length; index += 1) {
    const state = requireObject(charges[index], `Charge ${index}`, ["x", "y", "charge"]);
    const x = requireInteger(state.x, `Charge ${index} x`, 0, width - 1);
    const y = requireInteger(state.y, `Charge ${index} y`, 0, height - 1);
    const cellIndex = y * width + x;
    const kind = expectDefined(kinds[cellIndex], `tile kind at (${x}, ${y})`) as TileKind;
    if (kind === TileKind.WireCrossing) {
      throw new Error(`Charge ${index} targets a wire crossing`);
    }
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
  const crossingCharges = requireArray(board.crossingCharges, "Board crossing charges");
  const horizontalChargeByCell = new Int8Array(width * height);
  const verticalChargeByCell = new Int8Array(width * height);
  const hasCrossingCharge = new Uint8Array(width * height);
  for (let index = 0; index < crossingCharges.length; index += 1) {
    const state = requireObject(crossingCharges[index], `Crossing charge ${index}`, [
      "x",
      "y",
      "horizontal",
      "vertical",
    ]);
    const x = requireInteger(state.x, `Crossing charge ${index} x`, 0, width - 1);
    const y = requireInteger(state.y, `Crossing charge ${index} y`, 0, height - 1);
    const cellIndex = y * width + x;
    if (hasCrossingCharge[cellIndex] === 1) {
      throw new Error(`Crossing charge ${index} duplicates cell (${x}, ${y})`);
    }
    if (kinds[cellIndex] !== TileKind.WireCrossing) {
      throw new Error(`Crossing charge ${index} targets a non-crossing tile`);
    }

    const horizontal = requireInteger(
      state.horizontal,
      `Crossing charge ${index} horizontal`,
      -1,
      1,
    ) as Charge;
    const vertical = requireInteger(
      state.vertical,
      `Crossing charge ${index} vertical`,
      -1,
      1,
    ) as Charge;
    if (horizontal === 0 && vertical === 0) {
      throw new Error(`Crossing charge ${index} must contain a nonzero charge`);
    }
    horizontalChargeByCell[cellIndex] = horizontal;
    verticalChargeByCell[cellIndex] = vertical;
    hasCrossingCharge[cellIndex] = 1;
  }


  const welds = requireArray(board.welds, "Board weld grid");
  if (welds.length !== height) {
    throw new Error(`Board weld grid must contain exactly ${height} rows`);
  }
  const weldDirectionsByCell = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = requireString(welds[y], `Board weld grid row ${y}`);
    if (row.length !== width) {
      throw new Error(`Board weld grid row ${y} must contain exactly ${width} cells`);
    }

    for (let x = 0; x < width; x += 1) {
      const code = expectDefined(row[x], `weld code at (${x}, ${y})`);
      let directions: number;
      switch (code) {
        case ".":
          directions = 0;
          break;
        case "-":
          directions = 1;
          break;
        case "|":
          directions = 2;
          break;
        case "+":
          directions = 3;
          break;
        default:
          throw new Error(`Board weld grid cell (${x}, ${y}) has unknown weld code "${code}"`);
      }
      if ((directions & 1) !== 0 && x + 1 >= width) {
        throw new Error(`Board weld grid cell (${x}, ${y}) points right outside the board`);
      }
      if ((directions & 2) !== 0 && y + 1 >= height) {
        throw new Error(`Board weld grid cell (${x}, ${y}) points down outside the board`);
      }
      weldDirectionsByCell[y * width + x] = directions;
    }
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
      if (hasCrossingCharge[cellIndex] === 1) {
        const horizontal = expectDefined(
          horizontalChargeByCell[cellIndex],
          `horizontal crossing charge at (${x}, ${y})`,
        ) as Charge;
        const vertical = expectDefined(
          verticalChargeByCell[cellIndex],
          `vertical crossing charge at (${x}, ${y})`,
        ) as Charge;
        world.setCrossingCharges(x, y, horizontal, vertical);
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cellIndex = y * width + x;
      if (hasFurnaceState[cellIndex] === 1) {
        world.restoreFurnaceProgress(
          x,
          y,
          expectDefined(furnaceProgressByCell[cellIndex], "imported furnace progress"),
        );
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const directions = expectDefined(
        weldDirectionsByCell[y * width + x],
        `weld directions at (${x}, ${y})`,
      );
      if ((directions & 1) !== 0 && !world.setWeld(x, y, x + 1, y, true)) {
        throw new Error(`Board weld grid cell (${x}, ${y}) cannot weld right`);
      }
      if ((directions & 2) !== 0 && !world.setWeld(x, y, x, y + 1, true)) {
        throw new Error(`Board weld grid cell (${x}, ${y}) cannot weld down`);
      }
    }
  }

  if (result !== PuzzleResult.InProgress) {
    world.markPuzzleResult(result);
  }

  return { world, tick };
}

function requireObject(
  value: unknown,
  label: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const object = value as Record<string, unknown>;
  for (const field of Object.keys(object)) {
    if (!fields.includes(field)) {
      throw new Error(`${label} has unknown field "${field}"`);
    }
  }
  return object;
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
