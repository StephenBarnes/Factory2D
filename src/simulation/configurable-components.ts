import { isCharge, type Charge } from "./circuit";
import {
  DEFAULT_RUNE_ARRAY_DIMENSION,
  requireRuneArrayDimension,
  transformRuneArrayPorts,
  validateRuneArrayDescription,
} from "./rune-array";
import {
  Direction,
  flipDirectionHorizontally,
  flipDirectionVertically,
  isTileKind,
  orientationForKind,
  TileKind,
} from "./tile";
import type { World } from "./world";

export const MIN_DELAY_LENGTH = 1;
export const MAX_DELAY_LENGTH = 27;
export const DEFAULT_DELAY_LENGTH = 3;
export const MIN_DISCARD_LENGTH = 0;
export const MAX_DISCARD_LENGTH = 99;
export const DEFAULT_DISCARD_LENGTH = 3;
export const MIN_COUNTER_THRESHOLD = 1;
export const MAX_COUNTER_THRESHOLD = 99;
export const DEFAULT_COUNTER_THRESHOLD = 4;
export const MIN_ROM_DIMENSION = 1;
export const MAX_ROM_DIMENSION = 9;
export const DEFAULT_ROM_WIDTH = 3;
export const DEFAULT_ROM_HEIGHT = 3;
export const LUT_DIMENSION = 3;
export const MAX_SIGNAL_LABEL_LENGTH = 12;
/** Upper bound on the outputs one assembler recipe emits, and on a pending queue. */
export const MAX_ASSEMBLER_OUTPUTS = 9;

export interface NumericComponentConfiguration {
  readonly type: "number";
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly configureOnPlacement: boolean;
}

/** Two-dimensional ternary value grid shared by ROMs, lookup runes, and sequence checkers. */
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
const DISCARD_CONFIGURATION: NumericComponentConfiguration = Object.freeze({
  type: "number",
  label: "Discard length",
  minimum: MIN_DISCARD_LENGTH,
  maximum: MAX_DISCARD_LENGTH,
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

/**
 * Whether a tile kind carries sparse per-identity component state. Every configurable
 * component does; assemblers do too, for their pending output queue, without offering
 * any player-editable configuration.
 */
export function hasComponentState(kind: TileKind): boolean {
  return kind === TileKind.Assembler ||
    kind === TileKind.Rotator ||
    componentConfigurationForKind(kind) !== null;
}

export function componentConfigurationForKind(
  kind: TileKind,
): ComponentConfiguration | null {
  switch (kind) {
    case TileKind.Delay:
      return DELAY_CONFIGURATION;
    case TileKind.Discard:
      return DISCARD_CONFIGURATION;
    case TileKind.Counter:
      return COUNTER_CONFIGURATION;
    case TileKind.Rom:
    case TileKind.Lut:
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

export interface DiscardComponentState {
  readonly type: "discard";
  length: number;
  discarded: number;
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

export interface LutComponentState {
  readonly type: "lut";
  width: number;
  height: number;
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
  ignoreZeros: boolean;
  values: Int8Array;
}

export interface MonitorComponentState {
  readonly type: "monitor";
  label: string;
  category: string;
  order: number;
}

export interface GrapherComponentState {
  readonly type: "grapher";
  label: string;
  category: string;
  order: number;
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

export interface AssemblerOutput {
  readonly kind: TileKind;
  readonly orientation: Direction;
}

/**
 * Assembler output queue. `pendingKinds` and `pendingOrientations` hold every output of
 * the consumed recipe; `cursor` counts the outputs already emitted, so the queue is empty
 * once `cursor` reaches the length.
 */
export interface AssemblerComponentState {
  readonly type: "assembler";
  pendingKinds: Uint8Array;
  pendingOrientations: Uint8Array;
  cursor: number;
}

export interface RotatorComponentState {
  readonly type: "rotator";
  direction: Direction;
}

export type ConfigurableComponentState =
  | AssemblerComponentState
  | RotatorComponentState
  | DelayComponentState
  | DiscardComponentState
  | CounterComponentState
  | RomComponentState
  | LutComponentState
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

export interface DiscardComponentSnapshot {
  readonly type: "discard";
  readonly length: number;
  readonly discarded: number;
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

export interface LutComponentSnapshot {
  readonly type: "lut";
  readonly width: number;
  readonly height: number;
  readonly values: readonly Charge[];
}

export interface CheckerComponentSnapshot {
  readonly type: "checker";
  readonly width: number;
  readonly height: number;
  readonly cursor: number;
  readonly failed: boolean;
  readonly ignoreZeros: boolean;
  readonly values: readonly Charge[];
}

export interface MonitorComponentSnapshot {
  readonly type: "monitor";
  readonly label: string;
  readonly category: string;
  readonly order: number;
}

export interface GrapherComponentSnapshot {
  readonly type: "grapher";
  readonly label: string;
  readonly category: string;
  readonly order: number;
}

/** Snapshot of a rune array; `world` is an independent copy of the inner board. */
export interface RuneArrayComponentSnapshot {
  readonly type: "array";
  readonly description: string;
  readonly ports: readonly Charge[];
  readonly world: World;
}

/** Snapshot of an assembler's queue holding only the outputs still to be emitted. */
export interface AssemblerComponentSnapshot {
  readonly type: "assembler";
  readonly pending: readonly AssemblerOutput[];
}

export interface RotatorComponentSnapshot {
  readonly type: "rotator";
  readonly direction: Direction;
}

export type ConfigurableComponentSnapshot =
  | AssemblerComponentSnapshot
  | RotatorComponentSnapshot
  | DelayComponentSnapshot
  | DiscardComponentSnapshot
  | CounterComponentSnapshot
  | RomComponentSnapshot
  | LutComponentSnapshot
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
  orientation: Direction,
  createWorld: (width: number, height: number) => World,
): ConfigurableComponentState | null {
  switch (kind) {
    case TileKind.Assembler:
      return {
        type: "assembler",
        pendingKinds: new Uint8Array(0),
        pendingOrientations: new Uint8Array(0),
        cursor: 0,
      };
    case TileKind.Rotator:
      return { type: "rotator", direction: orientation };
    case TileKind.Delay:
      return {
        type: "delay",
        length: DEFAULT_DELAY_LENGTH,
        cursor: 0,
        data: new Int8Array(DEFAULT_DELAY_LENGTH),
      };
    case TileKind.Discard:
      return {
        type: "discard",
        length: DEFAULT_DISCARD_LENGTH,
        discarded: 0,
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
    case TileKind.Lut:
      return {
        type: "lut",
        width: LUT_DIMENSION,
        height: LUT_DIMENSION,
        values: new Int8Array(LUT_DIMENSION * LUT_DIMENSION),
      };
    case TileKind.Checker:
      return {
        type: "checker",
        width: DEFAULT_ROM_WIDTH,
        height: DEFAULT_ROM_HEIGHT,
        cursor: 0,
        failed: false,
        ignoreZeros: false,
        values: new Int8Array(DEFAULT_ROM_WIDTH * DEFAULT_ROM_HEIGHT),
      };
    case TileKind.Monitor:
      return { type: "monitor", label: "", category: "", order: 0 };
    case TileKind.Grapher:
      return { type: "grapher", label: "", category: "", order: 0 };
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
    case "assembler":
      return {
        type: "assembler",
        pendingKinds: state.pendingKinds.slice(),
        pendingOrientations: state.pendingOrientations.slice(),
        cursor: state.cursor,
      };
    case "rotator":
      return { type: "rotator", direction: state.direction };
    case "delay":
      return {
        type: "delay",
        length: state.length,
        cursor: state.cursor,
        data: state.data.slice(),
      };
    case "discard":
      return { type: "discard", length: state.length, discarded: state.discarded };
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
    case "lut":
      return {
        type: "lut",
        width: state.width,
        height: state.height,
        values: state.values.slice(),
      };
    case "checker":
      return {
        type: "checker",
        width: state.width,
        height: state.height,
        cursor: state.cursor,
        failed: state.failed,
        ignoreZeros: state.ignoreZeros,
        values: state.values.slice(),
      };
    case "monitor":
    case "grapher":
      return { type: state.type, label: state.label, category: state.category, order: state.order };
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
    case "assembler": {
      const pending: AssemblerOutput[] = [];
      for (let index = state.cursor; index < state.pendingKinds.length; index += 1) {
        pending.push({
          kind: state.pendingKinds[index] as TileKind,
          orientation: state.pendingOrientations[index] as Direction,
        });
      }
      return { type: "assembler", pending };
    }
    case "rotator":
      return { type: "rotator", direction: state.direction };
    case "delay":
      return {
        type: "delay",
        length: state.length,
        cursor: state.cursor,
        data: Array.from(state.data) as Charge[],
      };
    case "discard":
      return { type: "discard", length: state.length, discarded: state.discarded };
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
    case "lut":
      return {
        type: "lut",
        width: state.width,
        height: state.height,
        values: Array.from(state.values) as Charge[],
      };
    case "checker":
      return {
        type: "checker",
        width: state.width,
        height: state.height,
        cursor: state.cursor,
        failed: state.failed,
        ignoreZeros: state.ignoreZeros,
        values: Array.from(state.values) as Charge[],
      };
    case "monitor":
    case "grapher":
      return { type: state.type, label: state.label, category: state.category, order: state.order };
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
    case "assembler":
      if (!Array.isArray(snapshot.pending) || snapshot.pending.length > MAX_ASSEMBLER_OUTPUTS) {
        throw new RangeError(
          `Assembler queue must hold at most ${MAX_ASSEMBLER_OUTPUTS} pending outputs`,
        );
      }
      for (const output of snapshot.pending) {
        if (!isTileKind(output.kind) || output.kind === TileKind.Empty) {
          throw new RangeError("Assembler queue contains an invalid tile kind");
        }
        requireInteger(output.orientation, "Assembler output orientation", Direction.Up, Direction.Left);
      }
      break;
    case "rotator":
      requireInteger(snapshot.direction, "Rotator direction", Direction.Up, Direction.Left);
      break;
    case "delay":
      requireInteger(snapshot.length, "Delay length", MIN_DELAY_LENGTH, MAX_DELAY_LENGTH);
      requireInteger(snapshot.cursor, "Delay cursor", 0, snapshot.length - 1);
      requireCharges(snapshot.data, snapshot.length, "Delay data");
      break;
    case "discard":
      requireInteger(snapshot.length, "Discard length", MIN_DISCARD_LENGTH, MAX_DISCARD_LENGTH);
      requireInteger(snapshot.discarded, "Discard progress", 0, snapshot.length);
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
    case "lut":
      requireInteger(snapshot.width, "Lookup width", LUT_DIMENSION, LUT_DIMENSION);
      requireInteger(snapshot.height, "Lookup height", LUT_DIMENSION, LUT_DIMENSION);
      requireCharges(snapshot.values, LUT_DIMENSION * LUT_DIMENSION, "Lookup values");
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
      if (typeof snapshot.ignoreZeros !== "boolean") {
        throw new RangeError("Checker ignoreZeros flag must be a boolean");
      }
      if (snapshot.ignoreZeros && snapshot.values.includes(0)) {
        throw new RangeError("A checker that ignores zeros must expect only +1 and -1 values");
      }
      break;
    }
    case "monitor":
    case "grapher":
      validateSignalLabel(snapshot.label);
      validateSignalLabel(snapshot.category);
      requireInteger(snapshot.order, "Signal order", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
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
    case "assembler":
      return {
        type: "assembler",
        pendingKinds: Uint8Array.from(snapshot.pending, (output) => output.kind),
        pendingOrientations: Uint8Array.from(
          snapshot.pending,
          (output) => orientationForKind(output.kind, output.orientation),
        ),
        cursor: 0,
      };
    case "rotator":
      return { type: "rotator", direction: snapshot.direction };
    case "delay":
      return {
        type: "delay",
        length: snapshot.length,
        cursor: snapshot.cursor,
        data: Int8Array.from(snapshot.data),
      };
    case "discard":
      return { type: "discard", length: snapshot.length, discarded: snapshot.discarded };
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
    case "lut":
      return {
        type: "lut",
        width: snapshot.width,
        height: snapshot.height,
        values: Int8Array.from(snapshot.values),
      };
    case "checker":
      return {
        type: "checker",
        width: snapshot.width,
        height: snapshot.height,
        cursor: snapshot.cursor,
        failed: snapshot.failed,
        ignoreZeros: snapshot.ignoreZeros,
        values: Int8Array.from(snapshot.values),
      };
    case "monitor":
    case "grapher":
      return { type: snapshot.type, label: snapshot.label, category: snapshot.category, order: snapshot.order };
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
 * component snapshot. Rune arrays rotate their inner board and side ports with the tile
 * so gravity inside always stays downward, assemblers rotate pending output orientations,
 * and ROMs transform their value grid and cursor. Checkers and lookup tables keep value order.
 */
export function transformComponentSnapshot(
  snapshot: ConfigurableComponentSnapshot,
  quarterTurns: number,
  flippedHorizontally: boolean,
  flippedVertically: boolean,
): ConfigurableComponentSnapshot {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0 && !flippedHorizontally && !flippedVertically) {
    return snapshot;
  }
  if (snapshot.type === "rom") {
    const swapAxes = (turns & 1) === 1;
    const width = swapAxes ? snapshot.height : snapshot.width;
    const height = swapAxes ? snapshot.width : snapshot.height;
    const values = new Array<Charge>(snapshot.values.length);
    let cursor = 0;
    snapshot.values.forEach((value, index) => {
      const column = index % snapshot.width;
      const row = Math.floor(index / snapshot.width);
      let x = flippedHorizontally ? snapshot.width - 1 - column : column;
      let y = flippedVertically ? snapshot.height - 1 - row : row;
      for (let turn = 0; turn < turns; turn += 1) {
        const rotatedHeight = (turn & 1) === 0 ? snapshot.height : snapshot.width;
        const rotatedX = rotatedHeight - 1 - y;
        y = x;
        x = rotatedX;
      }
      const destination = y * width + x;
      values[destination] = value;
      if (index === snapshot.cursor) {
        cursor = destination;
      }
    });
    return { type: "rom", width, height, cursor, values };
  }
  if (snapshot.type === "assembler") {
    return {
      type: "assembler",
      pending: snapshot.pending.map((output) => transformAssemblerOutput(
        output,
        turns,
        flippedHorizontally,
        flippedVertically,
      )),
    };
  }
  if (snapshot.type === "rotator") {
    let direction = snapshot.direction;
    if (flippedHorizontally) {
      direction = flipDirectionHorizontally(direction);
    }
    if (flippedVertically) {
      direction = flipDirectionVertically(direction);
    }
    return {
      type: "rotator",
      direction: ((direction + turns) & 3) as Direction,
    };
  }
  if (snapshot.type !== "array") {
    return snapshot;
  }
  return {
    type: "array",
    description: snapshot.description,
    ports: transformRuneArrayPorts(snapshot.ports, turns, flippedHorizontally, flippedVertically),
    world: snapshot.world.transformed(turns, flippedHorizontally, flippedVertically),
  };
}

/** Flips, then rotates clockwise, the orientation of one queued assembler output. */
export function transformAssemblerOutput(
  output: AssemblerOutput,
  quarterTurns: number,
  flippedHorizontally: boolean,
  flippedVertically: boolean,
): AssemblerOutput {
  let orientation = output.orientation;
  if (flippedHorizontally) {
    orientation = flipDirectionHorizontally(orientation);
  }
  if (flippedVertically) {
    orientation = flipDirectionVertically(orientation);
  }
  orientation = ((orientation + quarterTurns) & 3) as Direction;
  return { kind: output.kind, orientation: orientationForKind(output.kind, orientation) };
}

export function componentStateMatchesKind(
  state: ConfigurableComponentState | ConfigurableComponentSnapshot,
  kind: TileKind,
): boolean {
  return (
    (state.type === "assembler" && kind === TileKind.Assembler) ||
    (state.type === "delay" && kind === TileKind.Delay) ||
    (state.type === "discard" && kind === TileKind.Discard) ||
    (state.type === "rotator" && kind === TileKind.Rotator) ||
    (state.type === "counter" && kind === TileKind.Counter) ||
    (state.type === "rom" && kind === TileKind.Rom) ||
    (state.type === "lut" && kind === TileKind.Lut) ||
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
