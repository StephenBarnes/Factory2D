import {
  hasComponentState,
  LUT_DIMENSION,
  MAX_ASSEMBLER_OUTPUTS,
  MAX_COUNTER_THRESHOLD,
  MAX_DELAY_LENGTH,
  MAX_DISCARD_LENGTH,
  MAX_ROM_DIMENSION,
  MIN_COUNTER_THRESHOLD,
  MIN_DELAY_LENGTH,
  MIN_DISCARD_LENGTH,
  MIN_ROM_DIMENSION,
  type ConfigurableComponentSnapshot,
  validateSignalLabel,
} from "./configurable-components";
import { isProcessingMachine, processingRecipeFor } from "./furnace";
import { isCharge, type Charge } from "./circuit";
import { PuzzleResult } from "./puzzle-result";
import type { TextBox } from "./text-box";
import {
  MAX_RUNE_ARRAY_DEPTH,
  MAX_RUNE_ARRAY_DIMENSION,
  MIN_RUNE_ARRAY_DIMENSION,
  requireRuneArrayDimension,
  validateRuneArrayDescription,
} from "./rune-array";
import {
  Direction,
  directionX,
  directionY,
  oppositeDirection,
  orientationForKind,
  TILE_DEFINITIONS,
  tileKindForBoardCode,
  TileKind,
} from "./tile";
import { World } from "./world";
import { expectDefined } from "../util/assert";

const FORMAT_NAME = "factory2d-board";
const FORMAT_VERSION = 15;
export const MIN_BOARD_WIDTH = 1;
export const MAX_BOARD_WIDTH = 400;
export const MIN_BOARD_HEIGHT = 1;
export const MAX_BOARD_HEIGHT = 300;

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
interface ExportedDelay {
  readonly x: number;
  readonly y: number;
  readonly type: "delay";
  readonly length: number;
  readonly cursor: number;
  readonly data: readonly Charge[];
}

interface ExportedDiscard {
  readonly x: number;
  readonly y: number;
  readonly type: "discard";
  readonly length: number;
  readonly discarded: number;
}

interface ExportedCounter {
  readonly x: number;
  readonly y: number;
  readonly type: "counter";
  readonly threshold: number;
  readonly count: number;
}

interface ExportedRom {
  readonly x: number;
  readonly y: number;
  readonly type: "rom";
  readonly width: number;
  readonly height: number;
  readonly cursor: number;
  readonly wrapX: boolean;
  readonly wrapY: boolean;
  readonly values: readonly Charge[];
}

interface ExportedLut {
  readonly x: number;
  readonly y: number;
  readonly type: "lut";
  readonly width: number;
  readonly height: number;
  readonly values: readonly Charge[];
}

interface ExportedChecker {
  readonly x: number;
  readonly y: number;
  readonly type: "checker";
  readonly width: number;
  readonly height: number;
  readonly cursor: number;
  readonly failed: boolean;
  readonly values: readonly Charge[];
}

interface ExportedSignalLabel {
  readonly x: number;
  readonly y: number;
  readonly type: "monitor" | "grapher";
  readonly label: string;
  readonly category?: string;
  readonly order?: number;
}

interface ExportedAssemblerOutput {
  readonly code: string;
  readonly direction: string;
}

/** Assembler output queue: the outputs still to be emitted, in emission order. */
interface ExportedAssembler {
  readonly x: number;
  readonly y: number;
  readonly type: "assembler";
  readonly pending: readonly ExportedAssemblerOutput[];
}

interface ExportedRotator {
  readonly x: number;
  readonly y: number;
  readonly type: "rotator";
  readonly direction: string;
}

/** Rune array whose inner board nests the same contents format without tick or result. */
interface ExportedRuneArray {
  readonly x: number;
  readonly y: number;
  readonly type: "array";
  readonly description: string;
  readonly ports: readonly Charge[];
  readonly board: ExportedBoardContents;
}

type ExportedComponent =
  | ExportedAssembler
  | ExportedRotator
  | ExportedDelay
  | ExportedDiscard
  | ExportedCounter
  | ExportedRom
  | ExportedLut
  | ExportedChecker
  | ExportedSignalLabel
  | ExportedRuneArray;

/** Tile, state, and weld grids shared by the top-level board and nested rune array boards. */
interface ExportedBoardContents {
  readonly width: number;
  readonly height: number;
  readonly grid: readonly string[];
  readonly orientations?: readonly ExportedOrientation[];
  readonly charges?: readonly ExportedCharge[];
  readonly crossingCharges?: readonly ExportedCrossingCharge[];
  readonly isolatedOutputCharges?: readonly ExportedCharge[];
  readonly furnaces?: readonly ExportedFurnace[];
  readonly components?: readonly ExportedComponent[];
  readonly textBoxes?: readonly TextBox[];
  readonly welds: readonly string[];
}

const BOARD_CONTENTS_FIELDS = [
  "width",
  "height",
  "grid",
  "orientations",
  "charges",
  "crossingCharges",
  "isolatedOutputCharges",
  "furnaces",
  "components",
  "textBoxes",
  "welds",
] as const;

interface ExportedBoard extends ExportedBoardContents {
  readonly format: typeof FORMAT_NAME;
  readonly version: typeof FORMAT_VERSION;
  readonly tick: number;
  readonly result: string;
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

  const contents = exportBoardContents(world);
  const board: ExportedBoard = {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    width: contents.width,
    height: contents.height,
    tick,
    result: PUZZLE_RESULT_NAMES[world.puzzleResult],
    grid: contents.grid,
    ...(contents.orientations === undefined ? {} : { orientations: contents.orientations }),
    ...(contents.charges === undefined ? {} : { charges: contents.charges }),
    ...(contents.crossingCharges === undefined
      ? {}
      : { crossingCharges: contents.crossingCharges }),
    ...(contents.isolatedOutputCharges === undefined ? {} : { isolatedOutputCharges: contents.isolatedOutputCharges }),
    ...(contents.furnaces === undefined ? {} : { furnaces: contents.furnaces }),
    ...(contents.components === undefined ? {} : { components: contents.components }),
    ...(contents.textBoxes === undefined ? {} : { textBoxes: contents.textBoxes }),
    welds: contents.welds,
  };
  return `${JSON.stringify(board, null, 2)}\n`;
}

function exportBoardContents(world: World): ExportedBoardContents {
  const grid: string[] = [];
  const orientations: ExportedOrientation[] = [];
  const charges: ExportedCharge[] = [];
  const crossingCharges: ExportedCrossingCharge[] = [];
  const isolatedOutputCharges: ExportedCharge[] = [];
  const furnaces: ExportedFurnace[] = [];
  const components: ExportedComponent[] = [];
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
      } else if (kind !== TileKind.RuneArray) {
        const charge = world.chargeAt(x, y);
        if (charge !== 0) {
          charges.push({ x, y, charge });
        }
      }
      if (kind === TileKind.Welder || kind === TileKind.Splitter || kind === TileKind.LaserSplitter ||
          kind === TileKind.Assembler || isProcessingMachine(kind)) {
        const outputCharge = world.chargeAtPort(
          x,
          y,
          kind === TileKind.Assembler
            ? ((orientation + Direction.Right) & 3) as Direction
            : oppositeDirection(orientation),
        );
        if (outputCharge !== 0) {
          isolatedOutputCharges.push({ x, y, charge: outputCharge });
        }
      }
      if (isProcessingMachine(kind)) {
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

      const componentState = world.componentStateSnapshotAt(x, y);
      if (componentState !== null) {
        if (componentState.type === "array") {
          components.push({
            x,
            y,
            type: "array",
            description: componentState.description,
            ports: componentState.ports,
            board: exportBoardContents(componentState.world),
          });
        } else if (componentState.type === "rotator") {
          components.push({
            x,
            y,
            type: "rotator",
            direction: DIRECTION_NAMES[componentState.direction],
          });
        } else if (componentState.type === "assembler") {
          components.push({
            x,
            y,
            type: "assembler",
            pending: componentState.pending.map((output) => ({
              code: TILE_DEFINITIONS[output.kind].boardCode,
              direction: DIRECTION_NAMES[output.orientation],
            })),
          });
        } else if (componentState.type === "monitor" || componentState.type === "grapher") {
          components.push({
            x,
            y,
            type: componentState.type,
            label: componentState.label,
            ...(componentState.category === "" ? {} : { category: componentState.category }),
            ...(componentState.order === 0 ? {} : { order: componentState.order }),
          });
        } else {
          components.push({ x, y, ...componentState });
        }
      }
    }
    grid.push(row);
    welds.push(weldRow);
  }

  return {
    width: world.width,
    height: world.height,
    grid,
    ...(orientations.length === 0 ? {} : { orientations }),
    ...(charges.length === 0 ? {} : { charges }),
    ...(crossingCharges.length === 0 ? {} : { crossingCharges }),
    ...(isolatedOutputCharges.length === 0 ? {} : { isolatedOutputCharges }),
    ...(furnaces.length === 0 ? {} : { furnaces }),
    ...(components.length === 0 ? {} : { components }),
    ...(world.textBoxes.length === 0 ? {} : { textBoxes: world.textBoxes }),
    welds,
  };
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
    "isolatedOutputCharges",
    "components",
    "textBoxes",
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
  const world = importBoardContents(
    board,
    "Board",
    MIN_BOARD_WIDTH,
    MAX_BOARD_WIDTH,
    MIN_BOARD_HEIGHT,
    MAX_BOARD_HEIGHT,
    0,
  );
  if (result !== PuzzleResult.InProgress) {
    world.markPuzzleResult(result);
  }
  return { world, tick };
}

/**
 * Builds a world from the shared board-contents fields. `label` prefixes every error so
 * nested rune array boards report their owning component; `depth` counts nesting levels.
 */
function importBoardContents(
  board: Record<string, unknown>,
  label: string,
  minimumWidth: number,
  maximumWidth: number,
  minimumHeight: number,
  maximumHeight: number,
  depth: number,
): World {
  if (depth > MAX_RUNE_ARRAY_DEPTH) {
    throw new Error(`${label} nests rune arrays deeper than ${MAX_RUNE_ARRAY_DEPTH} levels`);
  }
  const width = requireInteger(board.width, `${label} width`, minimumWidth, maximumWidth);
  const height = requireInteger(board.height, `${label} height`, minimumHeight, maximumHeight);
  if (depth > 0) {
    requireRuneArrayDimension(width, `${label} width`);
    requireRuneArrayDimension(height, `${label} height`);
  }
  const grid = requireArray(board.grid, `${label} grid`);
  if (grid.length !== height) {
    throw new Error(`${label} grid must contain exactly ${height} rows`);
  }

  const kinds = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const row = requireString(grid[y], `${label} grid row ${y}`);
    if (row.length !== width) {
      throw new Error(`${label} grid row ${y} must contain exactly ${width} cells`);
    }

    for (let x = 0; x < width; x += 1) {
      const code = expectDefined(row[x], `tile code at (${x}, ${y})`);
      const kind = tileKindForBoardCode(code);
      if (kind === undefined) {
        throw new Error(`${label} grid cell (${x}, ${y}) has unknown tile code "${code}"`);
      }
      kinds[y * width + x] = kind;
    }
  }

  const orientations = board.orientations === undefined
    ? []
    : requireArray(board.orientations, `${label} orientations`);
  const orientationByCell = new Uint8Array(width * height);
  const hasOrientation = new Uint8Array(width * height);
  for (let index = 0; index < orientations.length; index += 1) {
    const state = requireObject(orientations[index], entryLabel(label, depth, "Orientation", index), [
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

  const furnaces = board.furnaces === undefined
    ? []
    : requireArray(board.furnaces, `${label} furnaces`);
  const furnaceProgressByCell = new Uint16Array(width * height);
  const hasFurnaceState = new Uint8Array(width * height);
  for (let index = 0; index < furnaces.length; index += 1) {
    const state = requireObject(furnaces[index], entryLabel(label, depth, "Furnace", index), [
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
    const kind = expectDefined(kinds[cellIndex], `processing machine kind at (${x}, ${y})`) as TileKind;
    if (!isProcessingMachine(kind)) {
      throw new Error(`Processing state ${index} targets a non-processing tile`);
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
    const recipe = processingRecipeFor(kind, targetKind);
    if (recipe === undefined) {
      throw new Error(`Processing machine ${index} has no processable target`);
    }
    furnaceProgressByCell[cellIndex] = requireInteger(
      state.progress,
      `Furnace ${index} progress`,
      1,
      recipe.bakeTime - 1,
    );
    hasFurnaceState[cellIndex] = 1;
  }

  const charges = board.charges === undefined
    ? []
    : requireArray(board.charges, `${label} charges`);
  const chargeByCell = new Int8Array(width * height);
  const hasCharge = new Uint8Array(width * height);
  for (let index = 0; index < charges.length; index += 1) {
    const state = requireObject(charges[index], entryLabel(label, depth, "Charge", index), ["x", "y", "charge"]);
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
  const crossingCharges = board.crossingCharges === undefined
    ? []
    : requireArray(board.crossingCharges, `${label} crossing charges`);
  const horizontalChargeByCell = new Int8Array(width * height);
  const verticalChargeByCell = new Int8Array(width * height);
  const hasCrossingCharge = new Uint8Array(width * height);
  for (let index = 0; index < crossingCharges.length; index += 1) {
    const state = requireObject(crossingCharges[index], entryLabel(label, depth, "Crossing charge", index), [
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
  const isolatedOutputCharges = board.isolatedOutputCharges === undefined
    ? []
    : requireArray(board.isolatedOutputCharges, `${label} isolated output charges`);
  const isolatedOutputChargeByCell = new Int8Array(width * height);
  const hasIsolatedOutputCharge = new Uint8Array(width * height);
  for (let index = 0; index < isolatedOutputCharges.length; index += 1) {
    const chargeLabel = entryLabel(label, depth, "Isolated output charge", index);
    const state = requireObject(isolatedOutputCharges[index], chargeLabel, ["x", "y", "charge"]);
    const x = requireInteger(state.x, `${chargeLabel} x`, 0, width - 1);
    const y = requireInteger(state.y, `${chargeLabel} y`, 0, height - 1);
    const cellIndex = y * width + x;
    if (hasIsolatedOutputCharge[cellIndex] === 1) {
      throw new Error(`${chargeLabel} duplicates cell (${x}, ${y})`);
    }
    const kind = expectDefined(kinds[cellIndex], `tile kind at (${x}, ${y})`) as TileKind;
    if (kind !== TileKind.Welder && kind !== TileKind.Splitter && kind !== TileKind.LaserSplitter &&
        kind !== TileKind.Assembler && !isProcessingMachine(kind)) {
      throw new Error(`${chargeLabel} targets a tile without a separate isolated output`);
    }
    const charge = requireInteger(state.charge, `${chargeLabel} value`, -1, 1) as Charge;
    if (charge === 0) {
      throw new Error(`${chargeLabel} value must be -1 or 1`);
    }
    isolatedOutputChargeByCell[cellIndex] = charge;
    hasIsolatedOutputCharge[cellIndex] = 1;
  }



  const components = board.components === undefined
    ? []
    : requireArray(board.components, `${label} components`);
  const componentStatesByCell = new Array<ConfigurableComponentSnapshot | undefined>(
    width * height,
  );
  const componentStateAtCell = new Uint8Array(width * height);
  for (let index = 0; index < components.length; index += 1) {
    const componentLabel = entryLabel(label, depth, "Component", index);
    const entry = requireObject(components[index], componentLabel, [
      "x",
      "y",
      "type",
      "length",
      "cursor",
      "discarded",
      "data",
      "threshold",
      "count",
      "width",
      "height",
      "values",
      "failed",
      "label",
      "category",
      "order",
      "description",
      "ports",
      "board",
      "pending",
      "direction",
      "ignoreZeros",
      "wrapX",
      "wrapY",
    ]);
    const type = requireString(entry.type, `${componentLabel} type`);
    const fields = type === "assembler"
      ? ["x", "y", "type", "pending"]
      : type === "rotator"
        ? ["x", "y", "type", "direction"]
        : type === "discard"
          ? ["x", "y", "type", "length", "discarded"]
        : type === "delay"
          ? ["x", "y", "type", "length", "cursor", "data"]
          : type === "counter"
            ? ["x", "y", "type", "threshold", "count"]
            : type === "lut"
              ? ["x", "y", "type", "width", "height", "values"]
            : type === "rom"
              ? ["x", "y", "type", "width", "height", "cursor", "wrapX", "wrapY", "values"]
              : type === "checker"
                ? ["x", "y", "type", "width", "height", "cursor", "failed", "ignoreZeros", "values"]
                : type === "monitor" || type === "grapher"
                  ? ["x", "y", "type", "label", "category", "order"]
                  : type === "array"
                    ? ["x", "y", "type", "description", "ports", "board"]
                    : null;
    if (fields === null) {
      throw new Error(`${componentLabel} has unknown type "${type}"`);
    }
    const state = requireObject(components[index], componentLabel, fields);
    const x = requireInteger(state.x, `${componentLabel} x`, 0, width - 1);
    const y = requireInteger(state.y, `${componentLabel} y`, 0, height - 1);
    const cellIndex = y * width + x;
    if (componentStateAtCell[cellIndex] === 1) {
      throw new Error(`${componentLabel} duplicates cell (${x}, ${y})`);
    }
    const kind = expectDefined(kinds[cellIndex], `tile kind at (${x}, ${y})`) as TileKind;
    let snapshot: ConfigurableComponentSnapshot;
    if (type === "assembler") {
      const pending = requireArray(state.pending, `${componentLabel} pending`);
      if (pending.length > MAX_ASSEMBLER_OUTPUTS) {
        throw new Error(
          `${componentLabel} pending must contain at most ${MAX_ASSEMBLER_OUTPUTS} outputs`,
        );
      }
      snapshot = {
        type: "assembler",
        pending: pending.map((value, outputIndex) => {
          const outputLabel = `${componentLabel} pending output ${outputIndex}`;
          const output = requireObject(value, outputLabel, ["code", "direction"]);
          const code = requireString(output.code, `${outputLabel} code`);
          const outputKind = tileKindForBoardCode(code);
          if (outputKind === undefined || outputKind === TileKind.Empty) {
            throw new Error(`${outputLabel} has invalid tile code "${code}"`);
          }
          const directionName = requireString(output.direction, `${outputLabel} direction`);
          const direction = DIRECTIONS_BY_NAME[directionName];
          if (direction === undefined) {
            throw new Error(`${outputLabel} has unknown direction "${directionName}"`);
          }
          return { kind: outputKind, orientation: orientationForKind(outputKind, direction) };
        }),
      };
    } else if (type === "rotator") {
      const directionName = requireString(state.direction, `${componentLabel} direction`);
      const direction = DIRECTIONS_BY_NAME[directionName];
      if (direction === undefined) {
        throw new Error(`${componentLabel} has unknown direction "${directionName}"`);
      }
      snapshot = { type: "rotator", direction };
    } else if (type === "delay") {
      const length = requireInteger(
        state.length,
        `${componentLabel} length`,
        MIN_DELAY_LENGTH,
        MAX_DELAY_LENGTH,
      );
      snapshot = {
        type,
        length,
        cursor: requireInteger(state.cursor, `${componentLabel} cursor`, 0, length - 1),
        data: requireChargeArray(state.data, length, `${componentLabel} data`),
      };
    } else if (type === "discard") {
      const length = requireInteger(
        state.length,
        `${componentLabel} length`,
        MIN_DISCARD_LENGTH,
        MAX_DISCARD_LENGTH,
      );
      snapshot = {
        type,
        length,
        discarded: requireInteger(state.discarded, `${componentLabel} discarded`, 0, length),
      };
    } else if (type === "counter") {
      const threshold = requireInteger(
        state.threshold,
        `${componentLabel} threshold`,
        MIN_COUNTER_THRESHOLD,
        MAX_COUNTER_THRESHOLD,
      );
      snapshot = {
        type,
        threshold,
        count: requireInteger(state.count, `${componentLabel} count`, 0, threshold - 1),
      };
    } else if (type === "lut") {
      snapshot = {
        type,
        width: requireInteger(state.width, `${componentLabel} width`, LUT_DIMENSION, LUT_DIMENSION),
        height: requireInteger(state.height, `${componentLabel} height`, LUT_DIMENSION, LUT_DIMENSION),
        values: requireChargeArray(
          state.values,
          LUT_DIMENSION * LUT_DIMENSION,
          `${componentLabel} values`,
        ),
      };
    } else if (type === "array") {
      const description = requireString(state.description, `${componentLabel} description`);
      try {
        validateRuneArrayDescription(description);
      } catch (error) {
        throw new Error(`${componentLabel} description is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
      const innerBoard = requireObject(
        state.board,
        `${componentLabel} board`,
        BOARD_CONTENTS_FIELDS,
      );
      snapshot = {
        type: "array",
        description,
        ports: requireChargeArray(state.ports, 4, `${componentLabel} ports`),
        world: importBoardContents(
          innerBoard,
          `${componentLabel} board`,
          MIN_RUNE_ARRAY_DIMENSION,
          MAX_RUNE_ARRAY_DIMENSION,
          MIN_RUNE_ARRAY_DIMENSION,
          MAX_RUNE_ARRAY_DIMENSION,
          depth + 1,
        ),
      };
    } else if (type === "monitor" || type === "grapher") {
      const signalLabel = requireString(state.label, `${componentLabel} label`);
      try {
        validateSignalLabel(signalLabel);
      } catch (error) {
        throw new Error(`${componentLabel} label is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
      const category = state.category === undefined
        ? ""
        : requireString(state.category, `${componentLabel} category`);
      try {
        validateSignalLabel(category);
      } catch (error) {
        throw new Error(`${componentLabel} category is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
      const order = state.order === undefined
        ? 0
        : requireInteger(state.order, `${componentLabel} order`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
      snapshot = { type, label: signalLabel, category, order };
    } else {
      const componentWidth = requireInteger(
        state.width,
        `${componentLabel} width`,
        MIN_ROM_DIMENSION,
        MAX_ROM_DIMENSION,
      );
      const componentHeight = requireInteger(
        state.height,
        `${componentLabel} height`,
        MIN_ROM_DIMENSION,
        MAX_ROM_DIMENSION,
      );
      const valueCount = componentWidth * componentHeight;
      if (type === "checker") {
        if (typeof state.failed !== "boolean") {
          throw new Error(`${componentLabel} failed must be a boolean`);
        }
        const ignoreZeros = state.ignoreZeros === undefined ? false : state.ignoreZeros;
        if (typeof ignoreZeros !== "boolean") {
          throw new Error(`${componentLabel} ignoreZeros must be a boolean`);
        }
        snapshot = {
          type: "checker",
          width: componentWidth,
          height: componentHeight,
          cursor: requireInteger(
            state.cursor,
            `${componentLabel} cursor`,
            0,
            state.failed ? valueCount - 1 : valueCount,
          ),
          failed: state.failed,
          ignoreZeros,
          values: requireChargeArray(state.values, valueCount, `${componentLabel} values`),
        };
      } else {
        const wrapX = state.wrapX === undefined ? true : state.wrapX;
        const wrapY = state.wrapY === undefined ? true : state.wrapY;
        if (typeof wrapX !== "boolean" || typeof wrapY !== "boolean") {
          throw new Error(`${componentLabel} wrapping flags must be booleans`);
        }
        snapshot = {
          type: "rom",
          width: componentWidth,
          height: componentHeight,
          cursor: requireInteger(state.cursor, `${componentLabel} cursor`, 0, valueCount - 1),
          wrapX,
          wrapY,
          values: requireChargeArray(state.values, valueCount, `${componentLabel} values`),
        };
      }
    }
    if (
      !hasComponentState(kind) ||
      (snapshot.type === "assembler" && kind !== TileKind.Assembler) ||
      (snapshot.type === "rotator" && kind !== TileKind.Rotator) ||
      (snapshot.type === "delay" && kind !== TileKind.Delay) ||
      (snapshot.type === "discard" && kind !== TileKind.Discard) ||
      (snapshot.type === "counter" && kind !== TileKind.Counter) ||
      (snapshot.type === "rom" && kind !== TileKind.Rom) ||
      (snapshot.type === "lut" && kind !== TileKind.Lut) ||
      (snapshot.type === "checker" && kind !== TileKind.Checker) ||
      (snapshot.type === "monitor" && kind !== TileKind.Monitor) ||
      (snapshot.type === "grapher" && kind !== TileKind.Grapher) ||
      (snapshot.type === "array" && kind !== TileKind.RuneArray)
    ) {
      throw new Error(`${componentLabel} does not match the tile at (${x}, ${y})`);
    }
    componentStatesByCell[cellIndex] = snapshot;
    componentStateAtCell[cellIndex] = 1;
  }
  for (let cellIndex = 0; cellIndex < kinds.length; cellIndex += 1) {
    const kind = expectDefined(kinds[cellIndex], `tile kind at index ${cellIndex}`) as TileKind;
    if (hasComponentState(kind) && componentStateAtCell[cellIndex] !== 1) {
      const x = cellIndex % width;
      const y = (cellIndex - x) / width;
      throw new Error(`Configurable component at (${x}, ${y}) is missing state`);
    }
  }

  const welds = requireArray(board.welds, `${label} weld grid`);
  if (welds.length !== height) {
    throw new Error(`${label} weld grid must contain exactly ${height} rows`);
  }
  const weldDirectionsByCell = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = requireString(welds[y], `${label} weld grid row ${y}`);
    if (row.length !== width) {
      throw new Error(`${label} weld grid row ${y} must contain exactly ${width} cells`);
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
          throw new Error(`${label} weld grid cell (${x}, ${y}) has unknown weld code "${code}"`);
      }
      if ((directions & 1) !== 0 && x + 1 >= width) {
        throw new Error(`${label} weld grid cell (${x}, ${y}) points right outside the board`);
      }
      if ((directions & 2) !== 0 && y + 1 >= height) {
        throw new Error(`${label} weld grid cell (${x}, ${y}) points down outside the board`);
      }
      weldDirectionsByCell[y * width + x] = directions;
    }
  }

  const world = new World(width, height);
  if (board.textBoxes !== undefined) {
    try {
      // setTextBoxes performs complete runtime validation of these untrusted records.
      world.setTextBoxes(requireArray(board.textBoxes, `${label} textBoxes`) as TextBox[]);
    } catch (error) {
      throw new Error(`${label} textBoxes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
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
      if (hasIsolatedOutputCharge[cellIndex] === 1) {
        world.setIsolatedOutputCharge(
          x,
          y,
          expectDefined(
            isolatedOutputChargeByCell[cellIndex],
            `isolated output charge at (${x}, ${y})`,
          ) as Charge,
        );
      }
      const componentState = componentStatesByCell[cellIndex];
      if (componentState !== undefined) {
        world.restoreComponentState(x, y, componentState);
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
        throw new Error(`${label} weld grid cell (${x}, ${y}) cannot weld right`);
      }
      if ((directions & 2) !== 0 && !world.setWeld(x, y, x, y + 1, true)) {
        throw new Error(`${label} weld grid cell (${x}, ${y}) cannot weld down`);
      }
    }
  }

  return world;
}

/** Root boards keep their historical entry labels; nested boards prefix their owner. */
function entryLabel(label: string, depth: number, name: string, index: number): string {
  return depth === 0
    ? `${name} ${index}`
    : `${label} ${name.charAt(0).toLowerCase()}${name.slice(1)} ${index}`;
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
function requireChargeArray(
  value: unknown,
  length: number,
  label: string,
): readonly Charge[] {
  const entries = requireArray(value, label);
  if (entries.length !== length) {
    throw new Error(`${label} must contain exactly ${length} values`);
  }
  return entries.map((entry, index) => {
    const charge = requireInteger(entry, `${label} ${index}`, -1, 1);
    if (!isCharge(charge)) {
      throw new Error(`${label} ${index} must be a ternary charge`);
    }
    return charge;
  });
}

