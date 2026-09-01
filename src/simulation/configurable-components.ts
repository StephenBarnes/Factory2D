import { isCharge, type Charge } from "./circuit";
import { TileKind } from "./tile";

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

export interface NumericComponentConfiguration {
  readonly type: "number";
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly configureOnPlacement: boolean;
}

export interface RomComponentConfiguration {
  readonly type: "rom";
  readonly configureOnPlacement: boolean;
}

export type ComponentConfiguration =
  | NumericComponentConfiguration
  | RomComponentConfiguration;

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
const ROM_CONFIGURATION: RomComponentConfiguration = Object.freeze({
  type: "rom",
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
      return ROM_CONFIGURATION;
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

export type ConfigurableComponentState =
  | DelayComponentState
  | CounterComponentState
  | RomComponentState;

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

export type ConfigurableComponentSnapshot =
  | DelayComponentSnapshot
  | CounterComponentSnapshot
  | RomComponentSnapshot;

export function createDefaultComponentState(
  kind: TileKind,
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
  }
}

export function componentStateMatchesKind(
  state: ConfigurableComponentState | ConfigurableComponentSnapshot,
  kind: TileKind,
): boolean {
  return (
    (state.type === "delay" && kind === TileKind.Delay) ||
    (state.type === "counter" && kind === TileKind.Counter) ||
    (state.type === "rom" && kind === TileKind.Rom)
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
