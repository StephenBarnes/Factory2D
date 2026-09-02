import type { Charge } from "../simulation/circuit";
import { Direction, directionX, directionY, TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";
import { expectDefined } from "../util/assert";

/** One recorded signal-monitor column: `charges[i]` is the charge observed at tick `firstTick + i`. */
export interface MonitorSignalLine {
  readonly kind: "monitor";
  readonly id: number;
  readonly label: string;
  readonly firstTick: number;
  readonly charges: readonly Charge[];
}

/**
 * One grapher column: every stored value of the pointed ROM or sequence checker, or nothing
 * when neither is ahead. `values[i]` is drawn at panel row `firstRow + i`: ROM contents start
 * at row 0, while a checker's expected sequence is aligned with the tick whose input started
 * it, or slides along with the current tick while it is still waiting.
 */
export interface GrapherSignalLine {
  readonly kind: "grapher";
  readonly id: number;
  readonly label: string;
  readonly values: readonly Charge[];
  readonly firstRow: number;
  /** Index of the pointed component's cursor, or -1 when the grapher points at nothing. */
  readonly cursor: number;
}

export type SignalLine = MonitorSignalLine | GrapherSignalLine;

interface MonitorHistory {
  readonly firstTick: number;
  readonly charges: Charge[];
}

/**
 * Records every signal monitor's charge once per committed tick, keyed by stable tile ID.
 *
 * Histories are display state only: they never feed back into simulation. `sync` must be
 * called after every simulation step and at least once per rendered frame; it resets itself
 * whenever the observed world object changes, the tick moves backwards, or the tick-zero
 * board is edited, and refuses to skip ticks so missing step hooks fail loudly.
 */
export class SignalTraceRecorder {
  private world: World | null = null;
  private tick = -1;
  private revision = -1;
  private versionValue = 0;
  private readonly histories = new Map<number, MonitorHistory>();
  /** Tick whose input first started each checker, keyed by stable tile ID. */
  private readonly checkerStartTicks = new Map<number, number>();

  /** Increments whenever recorded histories change, so panels can cache derived lines. */
  get version(): number {
    return this.versionValue;
  }

  sync(world: World, tick: number): void {
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new RangeError(`Signal traces cannot observe tick ${tick}`);
    }
    if (world !== this.world || tick < this.tick) {
      this.reset(world, tick);
      return;
    }
    if (tick === this.tick) {
      if (tick === 0 && world.revision !== this.revision) {
        this.reset(world, tick);
      }
      return;
    }
    if (tick !== this.tick + 1) {
      throw new Error(`Signal traces observed tick ${tick} after tick ${this.tick}`);
    }
    this.tick = tick;
    this.revision = world.revision;
    this.sample(world, tick);
  }

  /** Builds the panel columns for every monitor and grapher on the board in row-major order. */
  lines(world: World): SignalLine[] {
    if (world !== this.world) {
      throw new Error("Signal traces must be synchronized before reading lines");
    }
    const lines: SignalLine[] = [];
    for (let index = 0; index < world.cellCount; index += 1) {
      const kind = world.kindAtIndex(index);
      if (kind === TileKind.Monitor) {
        const id = world.idAtIndex(index);
        const history = this.histories.get(id);
        const state = world.componentStateSnapshotAtIndex(index);
        if (state?.type !== "monitor") {
          throw new Error(`Signal monitor ${id} is missing its component state`);
        }
        lines.push({
          kind: "monitor",
          id,
          label: state.label,
          firstTick: history?.firstTick ?? this.tick,
          charges: history?.charges ?? [],
        });
      } else if (kind === TileKind.Grapher) {
        lines.push(this.grapherLine(world, index));
      }
    }
    return lines;
  }

  private grapherLine(world: World, index: number): GrapherSignalLine {
    const id = world.idAtIndex(index);
    const state = world.componentStateSnapshotAtIndex(index);
    if (state?.type !== "grapher") {
      throw new Error(`ROM grapher ${id} is missing its component state`);
    }
    const orientation = world.orientationAtIndex(index);
    const x = index % world.width + directionX(orientation);
    const y = Math.floor(index / world.width) + directionY(orientation);
    let values: readonly Charge[] = [];
    let firstRow = 0;
    let cursor = -1;
    if (x >= 0 && x < world.width && y >= 0 && y < world.height) {
      const targetIndex = y * world.width + x;
      const targetKind = world.kindAtIndex(targetIndex);
      if (targetKind === TileKind.Rom || targetKind === TileKind.Checker) {
        const target = world.componentStateSnapshotAtIndex(targetIndex);
        if (target?.type !== "rom" && target?.type !== "checker") {
          throw new Error(`Graphed component at (${x}, ${y}) is missing its component state`);
        }
        values = target.values;
        cursor = target.cursor;
        if (target.type === "checker") {
          firstRow = this.checkerStartTicks.get(world.idAtIndex(targetIndex)) ?? this.tick;
        }
      }
    }
    return { kind: "grapher", id, label: state.label, values, firstRow, cursor };
  }

  private reset(world: World, tick: number): void {
    this.world = world;
    this.tick = tick;
    this.revision = world.revision;
    this.histories.clear();
    this.checkerStartTicks.clear();
    this.sample(world, tick);
  }

  private sample(world: World, tick: number): void {
    for (let index = 0; index < world.cellCount; index += 1) {
      const kind = world.kindAtIndex(index);
      if (kind === TileKind.Checker) {
        this.sampleChecker(world, index, tick);
        continue;
      }
      if (kind !== TileKind.Monitor) {
        continue;
      }
      const id = world.idAtIndex(index);
      const charge = world.chargeAtPortIndex(index, Direction.Up);
      let history = this.histories.get(id);
      if (history === undefined) {
        history = { firstTick: tick, charges: [] };
        this.histories.set(id, history);
      } else if (history.firstTick + history.charges.length !== tick) {
        throw new Error(
          `Signal monitor ${id} history ends at tick ` +
          `${history.firstTick + history.charges.length} but observed tick ${tick}`,
        );
      }
      history.charges.push(charge);
    }
    this.versionValue += 1;
  }

  /**
   * Remembers the row of the input that started a checker: the state committed at `tick`
   * consumed the charge recorded at `tick - 1`, so the expected sequence aligns with that row.
   */
  private sampleChecker(world: World, index: number, tick: number): void {
    const id = world.idAtIndex(index);
    if (this.checkerStartTicks.has(id)) {
      return;
    }
    const state = world.componentStateSnapshotAtIndex(index);
    if (state?.type !== "checker") {
      throw new Error(`Sequence checker ${id} is missing its component state`);
    }
    if (state.cursor > 0 || state.failed) {
      this.checkerStartTicks.set(id, tick - 1);
    }
  }
}

/** Longest row count any line needs, so panels can size their scroll range. */
export function signalLineRowCount(line: SignalLine): number {
  return line.kind === "monitor"
    ? line.firstTick + line.charges.length
    : line.firstRow + line.values.length;
}

/** Charge shown at a panel row, or null where the line has no data for that row. */
export function signalLineChargeAtRow(line: SignalLine, row: number): Charge | null {
  if (line.kind === "monitor") {
    const offset = row - line.firstTick;
    return offset >= 0 && offset < line.charges.length
      ? expectDefined(line.charges[offset], "monitor charge")
      : null;
  }
  const valueIndex = row - line.firstRow;
  return valueIndex >= 0 && valueIndex < line.values.length
    ? expectDefined(line.values[valueIndex], "graphed value")
    : null;
}

/** Panel row carrying a grapher's cursor marker, or null when the cursor is past its values. */
export function grapherCursorRow(line: GrapherSignalLine): number | null {
  return line.cursor >= 0 && line.cursor < line.values.length
    ? line.firstRow + line.cursor
    : null;
}
