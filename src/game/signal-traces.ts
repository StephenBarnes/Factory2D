import type { Charge } from "../simulation/circuit";
import { Direction, directionX, directionY, TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";
import { WorldFeature } from "../simulation/world-features";
import { expectDefined } from "../util/assert";

/** One recorded signal-monitor column: `charges[i]` is the charge observed at tick `firstTick + i`. */
export interface MonitorSignalLine {
  readonly kind: "monitor";
  readonly id: number;
  readonly world: World;
  readonly label: string;
  readonly category: string;
  readonly order: number;
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
  readonly world: World;
  readonly label: string;
  readonly category: string;
  readonly order: number;
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
 * Records every signal monitor once per committed tick, keyed by array-ID path and tile ID.
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
  private readonly histories = new Map<string, MonitorHistory>();
  /** Tick whose input first started each checker, keyed by array-ID path and tile ID. */
  private readonly checkerStartTicks = new Map<string, number>();
  private readonly boardRevisions = new Map<World, number>();
  private readonly boardParents = new Map<World, World>();
  private readonly boardArrayIds = new Map<World, number>();

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
      if (world.revision !== this.revision || this.nestedBoardsChanged()) {
        if (tick === 0) {
          this.reset(world, tick);
        } else {
          this.revision = world.revision;
          this.captureBoardRevisions(world);
          this.versionValue += 1;
        }
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

  /** Groups categories by first appearance, then sorts by order with depth-first row-major ties. */
  lines(world: World): SignalLine[] {
    if (world !== this.world) {
      throw new Error("Signal traces must be synchronized before reading lines");
    }
    const lines: SignalLine[] = [];
    this.appendLines(world, "", lines);
    const categories = new Map<string, SignalLine[]>();
    for (const line of lines) {
      const group = categories.get(line.category);
      if (group === undefined) {
        categories.set(line.category, [line]);
      } else {
        group.push(line);
      }
    }
    lines.length = 0;
    for (const group of categories.values()) {
      group.sort((left, right) => left.order - right.order);
      for (const line of group) lines.push(line);
    }
    return lines;
  }

  /** Maps a signal source to its tile or nearest containing array on the displayed board. */
  visibleTileId(view: World, source: World | null, tileId: number | null): number | null {
    if (source === null || tileId === null || !this.boardRevisions.has(source)) return null;
    while (source !== view) {
      const parent = this.boardParents.get(source);
      if (parent === undefined) return null;
      tileId = expectDefined(this.boardArrayIds.get(source), "Signal board is missing its containing array ID");
      source = parent;
    }
    return tileId;
  }

  private appendLines(world: World, path: string, lines: SignalLine[]): void {
    for (let index = 0; index < world.cellCount; index += 1) {
      const kind = world.kindAtIndex(index);
      if (kind === TileKind.Monitor) {
        const id = world.idAtIndex(index);
        const history = this.histories.get(`${path}${id}`);
        const state = world.componentStateSnapshotAtIndex(index);
        if (state?.type !== "monitor") {
          throw new Error(`Signal monitor ${id} is missing its component state`);
        }
        lines.push({
          kind: "monitor",
          id,
          world,
          label: this.lineLabel(path, state.label, `Monitor ${id}`),
          category: state.category,
          order: state.order,
          firstTick: history?.firstTick ?? this.tick,
          charges: history?.charges ?? [],
        });
      } else if (kind === TileKind.Grapher) {
        lines.push(this.grapherLine(world, index, path));
      } else if (kind === TileKind.RuneArray) {
        this.appendLines(world.runeArrayWorldAtIndex(index), `${path}${world.idAtIndex(index)}/`, lines);
      }
    }
  }

  private grapherLine(world: World, index: number, path: string): GrapherSignalLine {
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
    let label = state.label;
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
        if (target.type === "checker" && target.ignoreZeros) {
          // Gaps have no fixed duration: show sequence positions, not predicted input ticks.
          label = `${label || "Sequence"} (pulses)`;
        } else if (target.type === "checker") {
          firstRow = this.checkerStartTicks.get(`${path}${world.idAtIndex(targetIndex)}`) ?? this.tick;
        }
      }
    }
    return {
      kind: "grapher", id, world,
      label: this.lineLabel(path, label, `Lore ${id}`),
      category: state.category,
      order: state.order,
      values, firstRow, cursor,
    };
  }

  private lineLabel(path: string, label: string, fallback: string): string {
    return path === "" ? label : `#${path.slice(0, -1)} · ${label || fallback}`;
  }

  private nestedBoardsChanged(): boolean {
    for (const [board, revision] of this.boardRevisions) {
      if (board.revision !== revision) return true;
    }
    return false;
  }

  private captureBoardRevisions(world: World): void {
    this.boardRevisions.clear();
    this.boardParents.clear();
    this.boardArrayIds.clear();
    this.visitBoardRevisions(world);
  }

  private visitBoardRevisions(world: World): void {
    this.boardRevisions.set(world, world.revision);
    for (
      let index = world.firstFeatureIndex(WorldFeature.RuneArray);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.RuneArray, index)
    ) {
      const inner = world.runeArrayWorldAtIndex(index);
      this.boardParents.set(inner, world);
      this.boardArrayIds.set(inner, world.idAtIndex(index));
      this.visitBoardRevisions(inner);
    }
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
    this.boardRevisions.clear();
    this.boardParents.clear();
    this.boardArrayIds.clear();
    this.sampleBoard(world, tick, "");
    this.versionValue += 1;
  }

  private sampleBoard(world: World, tick: number, path: string): void {
    this.boardRevisions.set(world, world.revision);
    for (let index = 0; index < world.cellCount; index += 1) {
      const kind = world.kindAtIndex(index);
      if (kind === TileKind.RuneArray) {
        const inner = world.runeArrayWorldAtIndex(index);
        const id = world.idAtIndex(index);
        this.boardParents.set(inner, world);
        this.boardArrayIds.set(inner, id);
        this.sampleBoard(inner, tick, `${path}${id}/`);
        continue;
      }
      if (kind === TileKind.Checker) {
        this.sampleChecker(world, index, tick, path);
        continue;
      }
      if (kind !== TileKind.Monitor) {
        continue;
      }
      const id = `${path}${world.idAtIndex(index)}`;
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
  }

  /**
   * Remembers the row of the input that started a checker: the state committed at `tick`
   * consumed the charge recorded at `tick - 1`, so the expected sequence aligns with that row.
   */
  private sampleChecker(world: World, index: number, tick: number, path: string): void {
    const id = `${path}${world.idAtIndex(index)}`;
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
