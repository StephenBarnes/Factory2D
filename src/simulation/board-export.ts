import { Direction, TileKind } from "./tile";
import { World } from "./world";

const FORMAT_NAME = "factory2d-board";
const FORMAT_VERSION = 1;
const MAX_BOARD_WIDTH = 400;
const MAX_BOARD_HEIGHT = 300;

const TILE_KIND_NAMES: Readonly<Record<TileKind, string>> = {
  [TileKind.Empty]: "empty",
  [TileKind.Stone]: "stone",
  [TileKind.Sand]: "sand",
  [TileKind.Platform]: "platform",
  [TileKind.Magnet]: "magnet",
  [TileKind.Metal]: "metal",
};

const TILE_KINDS_BY_NAME: Readonly<Record<string, TileKind | undefined>> = {
  stone: TileKind.Stone,
  sand: TileKind.Sand,
  platform: TileKind.Platform,
  magnet: TileKind.Magnet,
  metal: TileKind.Metal,
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

interface ExportedTile {
  readonly x: number;
  readonly y: number;
  readonly kind: string;
  readonly orientation?: string;
}

interface ExportedWeld {
  readonly x: number;
  readonly y: number;
  readonly direction: "right" | "down";
}

interface ExportedBoard {
  readonly format: typeof FORMAT_NAME;
  readonly version: typeof FORMAT_VERSION;
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly tiles: readonly ExportedTile[];
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

  const tiles: ExportedTile[] = [];
  const welds: ExportedWeld[] = [];

  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const kind = world.kindAt(x, y);
      if (kind === TileKind.Empty) {
        continue;
      }

      const orientation = world.orientationAt(x, y);
      tiles.push({
        x,
        y,
        kind: TILE_KIND_NAMES[kind],
        ...(orientation === Direction.Up
          ? {}
          : { orientation: DIRECTION_NAMES[orientation] }),
      });

      if (x + 1 < world.width && world.isWelded(x, y, x + 1, y)) {
        welds.push({ x, y, direction: "right" });
      }
      if (y + 1 < world.height && world.isWelded(x, y, x, y + 1)) {
        welds.push({ x, y, direction: "down" });
      }
    }
  }

  const board: ExportedBoard = {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    width: world.width,
    height: world.height,
    tick,
    tiles,
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

  const width = requireInteger(board.width, "Board width", 1, MAX_BOARD_WIDTH);
  const height = requireInteger(board.height, "Board height", 1, MAX_BOARD_HEIGHT);
  const tick = requireInteger(board.tick, "Board tick", 0, Number.MAX_SAFE_INTEGER);
  const tiles = requireArray(board.tiles, "Board tiles");
  const welds = requireArray(board.welds, "Board welds");
  const world = new World(width, height);
  const occupied = new Uint8Array(world.cellCount);

  for (let index = 0; index < tiles.length; index += 1) {
    const tile = requireObject(tiles[index], `Tile ${index}`);
    const x = requireInteger(tile.x, `Tile ${index} x`, 0, width - 1);
    const y = requireInteger(tile.y, `Tile ${index} y`, 0, height - 1);
    const cellIndex = y * width + x;
    if (occupied[cellIndex] === 1) {
      throw new Error(`Tile ${index} duplicates cell (${x}, ${y})`);
    }

    const kindName = requireString(tile.kind, `Tile ${index} kind`);
    const kind = TILE_KINDS_BY_NAME[kindName];
    if (kind === undefined) {
      throw new Error(`Tile ${index} has unknown kind "${kindName}"`);
    }

    let orientation = Direction.Up;
    if (tile.orientation !== undefined) {
      const orientationName = requireString(tile.orientation, `Tile ${index} orientation`);
      const parsedOrientation = DIRECTIONS_BY_NAME[orientationName];
      if (parsedOrientation === undefined) {
        throw new Error(`Tile ${index} has unknown orientation "${orientationName}"`);
      }
      orientation = parsedOrientation;
    }

    world.place(x, y, kind, orientation);
    occupied[cellIndex] = 1;
  }

  for (let index = 0; index < welds.length; index += 1) {
    const weld = requireObject(welds[index], `Weld ${index}`);
    const x = requireInteger(weld.x, `Weld ${index} x`, 0, width - 1);
    const y = requireInteger(weld.y, `Weld ${index} y`, 0, height - 1);
    const direction = requireString(weld.direction, `Weld ${index} direction`);
    if (direction !== "right" && direction !== "down") {
      throw new Error(`Weld ${index} direction must be "right" or "down"`);
    }

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
