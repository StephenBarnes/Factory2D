import { isCharge, type Charge } from "./circuit";
import {
  DEFAULT_RUNE_ARRAY_DIMENSION,
  requireRuneArrayDimension,
  transformRuneArrayPorts,
  validateRuneArrayDescription,
} from "./rune-array";
import { TileKind } from "./tile";
import type { World } from "./world";

export const MIN_DELAY_LENGTH = 1;
export const MAX_DELAY_LENGTH = 27;
export const DEFAULT_DELAY_LENGTH = 3;
export const MIN_COUNTER_THRESHOLD = 1;
export const MAX_COUNTER_THRESHOLD = 99;
export const DEFAULT_COUNTER_THRESHOLD = 4;
export const MIN_ROM_DIMENSION = 1;
export const MAX_ROM_DIMENSION = 9;
export const DEFAULT_ROM_WIDTH = 3;
export const DEFAULT_ROM_HEIGHT = 3;
export const MAX_SIGNAL_LABEL_LENGTH = 12;

export interface NumericComponentConfiguration {
  readonly type: "number";
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly configureOnPlacement: boolean;
}

/** Two-dimensional ternary value grid shared by ROMs and sequence checkers. */
export interface TernaryGridComponentConfiguration {
  readonly type: "grid";
  readonly configureOnPlacement: boolean;
}

export interface TextComponentConfiguration {
  readonly type: "text";
  readonly label: string;
  readonly maximumLength: number;
  readonly configureOnPlacement: boolean;
}

/** Odd inner-board dimensions plus a free-text description for rune arrays. */
export interface RuneArrayComponentConfiguration {
  readonly type: "array";
  readonly configureOnPlacement: boolean;
}

export type ComponentConfiguration =
  | NumericComponentConfiguration
  | TernaryGridComponentConfiguration
  | TextComponentConfiguration
  | RuneArrayComponentConfiguration;

const DELAY_CONFIGURATION: NumericComponentConfiguration = Object.freeze({
  type: "number",
  label: "Delay length",
  minimum: MIN_DELAY_LENGTH,
  maximum: MAX_DELAY_LENGTH,
  configureOnPlacement: false,
});
const COUNTER_CONFIGURATION: NumericComponentConfiguration = Object.freeze({
  type: "number",
  label: "Threshold",
  minimum: MIN_COUNTER_THRESHOLD,
  maximum: MAX_COUNTER_THRESHOLD,
  configureOnPlacement: false,
});
const TERNARY_GRID_CONFIGURATION: TernaryGridComponentConfiguration = Object.freeze({
  type: "grid",
  configureOnPlacement: false,
});
const SIGNAL_LABEL_CONFIGURATION: TextComponentConfiguration = Object.freeze({
  type: "text",
  label: "Signal name",
  maximumLength: MAX_SIGNAL_LABEL_LENGTH,
  configureOnPlacement: false,
});
const RUNE_ARRAY_CONFIGURATION: RuneArrayComponentConfiguration = Object.freeze({
  type: "array",
  configureOnPlacement: false,
});

export function componentConfigurationForKind(
  kind: TileKind,
): ComponentConfiguration | null {
  switch (kind) {
    case TileKind.Delay:
      return DELAY_CONFIGURATION;
    case TileKind.Counter:
      return COUNTER_CONFIGURATION;
    case TileKind.Rom:
    case TileKind.Checker:
      return TERNARY_GRID_CONFIGURATION;
    case TileKind.Monitor:
    case TileKind.Grapher:
      return SIGNAL_LABEL_CONFIGURATION;
    case TileKind.RuneArray:
      return RUNE_ARRAY_CONFIGURATION;
    default:
      return null;
  }
}

export interface DelayComponentState {
  readonly type: "delay";
  length: number;
  cursor: number;
  data: Int8Array;
}

export interface CounterComponentState {
  readonly type: "counter";
  threshold: number;
  count: number;
}

export interface RomComponentState {
  readonly type: "rom";
  width: number;
  height: number;
  cursor: number;
  values: Int8Array;
}

/**
 * Expected-sequence checker. `values` are read in row-major order; `cursor` counts matched
 * values (0 while waiting for the first nonzero input, `values.length` once complete) and
 * stays on the mismatched value when `failed`.
 */
export interface CheckerComponentState {
  readonly type: "checker";
  width: number;
  height: number;
  cursor: number;
  failed: boolean;
  values: Int8Array;
}

export interface MonitorComponentState {
  readonly type: "monitor";
  label: string;
}

export interface GrapherComponentState {
  readonly type: "grapher";
  label: string;
}

/**
 * Rune array: an exclusively owned inner board whose edge-center cells are wired to the
 * array's outer sides. `ports[direction]` holds the committed charge of each side's
 * circuit network, which the inner board sees as a virtual conduit beyond its edge.
 */
export interface RuneArrayComponentState {
  readonly type: "array";
  description: string;
  ports: Int8Array;
  world: World;
}

export type ConfigurableComponentState =
  | DelayComponentState
  | CounterComponentState
  | RomComponentState
  | CheckerComponentState
  | MonitorComponentState
  | GrapherComponentState
  | RuneArrayComponentState;

export interface DelayComponentSnapshot {
  readonly type: "delay";
  readonly length: number;
  readonly cursor: number;
  readonly data: readonly Charge[];
}

export interface CounterComponentSnapshot {
  readonly type: "counter";
  readonly threshold: number;
  readonly count: number;
}

export interface RomComponentSnapshot {
  readonly type: "rom";
  readonly width: number;
  readonly height: number;
  readonly cursor: number;
  readonly values: readonly Charge[];
}

export interface CheckerComponentSnapshot {
  readonly type: "checker";
  readonly width: number;
  readonly height: number;
  readonly cursor: number;
  readonly failed: boolean;
  readonly values: readonly Charge[];
}

export interface MonitorComponentSnapshot {
  readonly type: "monitor";
  readonly label: string;
}

export interface GrapherComponentSnapshot {
  readonly type: "grapher";
  readonly label: string;
}

/** Snapshot of a rune array; `world` is an independent copy of the inner board. */
export interface RuneArrayComponentSnapshot {
  readonly type: "array";
  readonly description: string;
  readonly ports: readonly Charge[];
  readonly world: World;
}

export type ConfigurableComponentSnapshot =
  | DelayComponentSnapshot
  | CounterComponentSnapshot
  | RomComponentSnapshot
  | CheckerComponentSnapshot
  | MonitorComponentSnapshot
  | GrapherComponentSnapshot
  | RuneArrayComponentSnapshot;

/**
 * Creates the initial state for a configurable tile. Rune arrays need an inner board, which
 * `createWorld` supplies so this module never constructs worlds itself.
 */
export function createDefaultComponentState(
  kind: TileKind,
  createWorld: (width: number, height: number) => World,
): ConfigurableComponentState | null {
  switch (kind) {
    case TileKind.Delay:
      return {
        type: "delay",
        length: DEFAULT_DELAY_LENGTH,
        cursor: 0,
        data: new Int8Array(DEFAULT_DELAY_LENGTH),
      };
    case TileKind.Counter:
      return {
        type: "counter",
        threshold: DEFAULT_COUNTER_THRESHOLD,
        count: 0,
      };
    case TileKind.Rom:
      return {
        type: "rom",
        width: DEFAULT_ROM_WIDTH,
        height: DEFAULT_ROM_HEIGHT,
        cursor: 0,
        values: new Int8Array(DEFAULT_ROM_WIDTH * DEFAULT_ROM_HEIGHT),
      };
    case TileKind.Checker:
      return {
        type: "checker",
        width: DEFAULT_ROM_WIDTH,
        height: DEFAULT_ROM_HEIGHT,
        cursor: 0,
        failed: false,
        values: new Int8Array(DEFAULT_ROM_WIDTH * DEFAULT_ROM_HEIGHT),
      };
    case TileKind.Monitor:
      return { type: "monitor", label: "" };
    case TileKind.Grapher:
      return { type: "grapher", label: "" };
    case TileKind.RuneArray:
      return {
        type: "array",
        description: "",
        ports: new Int8Array(4),
        world: createWorld(DEFAULT_RUNE_ARRAY_DIMENSION, DEFAULT_RUNE_ARRAY_DIMENSION),
      };
    default:
      return null;
  }
}

export function cloneComponentState(
  state: ConfigurableComponentState,
): ConfigurableComponentState {
  switch (state.type) {
    case "delay":
      return {
        type: "delay",
        length: state.length,
        cursor: state.cursor,
        data: state.data.slice(),
      };
    case "counter":
      return {
        type: "counter",
        threshold: state.threshold,
        count: state.count,
      };
    case "rom":
      return {
        type: "rom",
        width: state.width,
        height: state.height,
        cursor: state.cursor,
        values: state.values.slice(),
      };
    case "checker":
      return {
        type: "checker",
        width: state.width,
        height: state.height,
        cursor: state.cursor,
        failed: state.failed,
        values: state.values.slice(),
      };
    case "monitor":
    case "grapher":
      return { type: state.type, label: state.label };
    case "array":
      return {
        type: "array",
        description: state.description,
        ports: state.ports.slice(),
        world: state.world.clone(),
      };
  }
}

export function snapshotComponentState(
  state: ConfigurableComponentState,
): ConfigurableComponentSnapshot {
  switch (state.type) {
    case "delay":
      return {
        type: "delay",
        length: state.length,
        cursor: state.cursor,
        data: Array.from(state.data) as Charge[],
      };
    case "counter":
      return {
        type: "counter",
        threshold: state.threshold,
        count: state.count,
      };
    case "rom":
      return {
        type: "rom",
        width: state.width,
        height: state.height,
        cursor: state.cursor,
        values: Array.from(state.values) as Charge[],
      };
    case "checker":
      return {
        type: "checker",
        width: state.width,
        height: state.height,
        cursor: state.cursor,
        failed: state.failed,
        values: Array.from(state.values) as Charge[],
      };
    case "monitor":
    case "grapher":
      return { type: state.type, label: state.label };
    case "array":
      return {
        type: "array",
        description: state.description,
        ports: Array.from(state.ports) as Charge[],
        world: state.world.clone(),
      };
  }
}

export function validateComponentSnapshot(
  snapshot: ConfigurableComponentSnapshot,
): void {
  switch (snapshot.type) {
    case "delay":
      requireInteger(snapshot.length, "Delay length", MIN_DELAY_LENGTH, MAX_DELAY_LENGTH);
      requireInteger(snapshot.cursor, "Delay cursor", 0, snapshot.length - 1);
      requireCharges(snapshot.data, snapshot.length, "Delay data");
      break;
    case "counter":
      requireInteger(
        snapshot.threshold,
        "Counter threshold",
        MIN_COUNTER_THRESHOLD,
        MAX_COUNTER_THRESHOLD,
      );
      requireInteger(snapshot.count, "Counter count", 0, snapshot.threshold - 1);
      break;
    case "rom":
      requireInteger(snapshot.width, "ROM width", MIN_ROM_DIMENSION, MAX_ROM_DIMENSION);
      requireInteger(snapshot.height, "ROM height", MIN_ROM_DIMENSION, MAX_ROM_DIMENSION);
      requireInteger(snapshot.cursor, "ROM cursor", 0, snapshot.width * snapshot.height - 1);
      requireCharges(snapshot.values, snapshot.width * snapshot.height, "ROM values");
      break;
    case "checker": {
      requireInteger(snapshot.width, "Checker width", MIN_ROM_DIMENSION, MAX_ROM_DIMENSION);
      requireInteger(snapshot.height, "Checker height", MIN_ROM_DIMENSION, MAX_ROM_DIMENSION);
      const valueCount = snapshot.width * snapshot.height;
      if (typeof snapshot.failed !== "boolean") {
        throw new RangeError("Checker failed flag must be a boolean");
      }
      requireInteger(
        snapshot.cursor,
        "Checker cursor",
        0,
        snapshot.failed ? valueCount - 1 : valueCount,
      );
      requireCharges(snapshot.values, valueCount, "Checker values");
      break;
    }
    case "monitor":
    case "grapher":
      validateSignalLabel(snapshot.label);
      break;
    case "array":
      validateRuneArrayDescription(snapshot.description);
      requireCharges(snapshot.ports, 4, "Rune array ports");
      requireRuneArrayDimension(snapshot.world.width, "Rune array width");
      requireRuneArrayDimension(snapshot.world.height, "Rune array height");
      break;
  }
}

export function validateSignalLabel(label: string): void {
  if (typeof label !== "string" || label.length > MAX_SIGNAL_LABEL_LENGTH) {
    throw new RangeError(`Signal name must be a string of at most ${MAX_SIGNAL_LABEL_LENGTH} characters`);
  }
  for (const character of label) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) {
      throw new RangeError("Signal name must not contain control characters");
    }
  }
}

export function stateFromSnapshot(
  snapshot: ConfigurableComponentSnapshot,
): ConfigurableComponentState {
  validateComponentSnapshot(snapshot);
  switch (snapshot.type) {
    case "delay":
      return {
        type: "delay",
        length: snapshot.length,
        cursor: snapshot.cursor,
        data: Int8Array.from(snapshot.data),
      };
    case "counter":
      return {
        type: "counter",
        threshold: snapshot.threshold,
        count: snapshot.count,
      };
    case "rom":
      return {
        type: "rom",
        width: snapshot.width,
        height: snapshot.height,
        cursor: snapshot.cursor,
        values: Int8Array.from(snapshot.values),
      };
    case "checker":
      return {
        type: "checker",
        width: snapshot.width,
        height: snapshot.height,
        cursor: snapshot.cursor,
        failed: snapshot.failed,
        values: Int8Array.from(snapshot.values),
      };
    case "monitor":
    case "grapher":
      return { type: snapshot.type, label: snapshot.label };
    case "array":
      return {
        type: "array",
        description: snapshot.description,
        ports: Int8Array.from(snapshot.ports),
        world: snapshot.world.clone(),
      };
  }
}

/**
 * Applies a selection-style transform (flips, then clockwise quarter turns) to a
 * component snapshot. Only rune arrays carry oriented state: their inner board and side
 * ports rotate with the tile so gravity inside always stays downward.
 */
export function transformComponentSnapshot(
  snapshot: ConfigurableComponentSnapshot,
  quarterTurns: number,
  flippedHorizontally: boolean,
  flippedVertically: boolean,
): ConfigurableComponentSnapshot {
  if (snapshot.type !== "array") {
    return snapshot;
  }
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0 && !flippedHorizontally && !flippedVertically) {
    return snapshot;
  }
  return {
    type: "array",
    description: snapshot.description,
    ports: transformRuneArrayPorts(snapshot.ports, turns, flippedHorizontally, flippedVertically),
    world: snapshot.world.transformed(turns, flippedHorizontally, flippedVertically),
  };
}

export function componentStateMatchesKind(
  state: ConfigurableComponentState | ConfigurableComponentSnapshot,
  kind: TileKind,
): boolean {
  return (
    (state.type === "delay" && kind === TileKind.Delay) ||
    (state.type === "counter" && kind === TileKind.Counter) ||
    (state.type === "rom" && kind === TileKind.Rom) ||
    (state.type === "checker" && kind === TileKind.Checker) ||
    (state.type === "monitor" && kind === TileKind.Monitor) ||
    (state.type === "grapher" && kind === TileKind.Grapher) ||
    (state.type === "array" && kind === TileKind.RuneArray)
  );
}

function requireInteger(value: number, label: string, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
}

function requireCharges(values: readonly number[], length: number, label: string): void {
  if (values.length !== length) {
    throw new RangeError(`${label} must contain exactly ${length} values`);
  }
  for (const value of values) {
    if (!isCharge(value)) {
      throw new RangeError(`${label} contains invalid charge ${value}`);
    }
  }
}
