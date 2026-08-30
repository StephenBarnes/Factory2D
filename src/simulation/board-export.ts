import { Direction, TileKind } from "./tile";
import type { World } from "./world";

const FORMAT_NAME = "factory2d-board";
const FORMAT_VERSION = 1;

const TILE_KIND_NAMES: Readonly<Record<TileKind, string>> = {
  [TileKind.Empty]: "empty",
  [TileKind.Stone]: "stone",
  [TileKind.Sand]: "sand",
  [TileKind.Platform]: "platform",
  [TileKind.Magnet]: "magnet",
  [TileKind.Metal]: "metal",
};

const DIRECTION_NAMES: Readonly<Record<Direction, string>> = {
  [Direction.Up]: "up",
  [Direction.Right]: "right",
  [Direction.Down]: "down",
  [Direction.Left]: "left",
};

interface ExportedTile {
  readonly x: number;
  readonly y: number;
  readonly kind: string;
  readonly orientation: string;
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

export function serializeBoard(world: World, tick: number): string {
  if (!Number.isInteger(tick) || tick < 0) {
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

      tiles.push({
        x,
        y,
        kind: TILE_KIND_NAMES[kind],
        orientation: DIRECTION_NAMES[world.orientationAt(x, y)],
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
