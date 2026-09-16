import {
  cloneComponentState,
  componentConfigurationForKind,
  componentStateMatchesKind,
  createDefaultComponentState,
  hasComponentState,
  LUT_DIMENSION,
  MAX_ASSEMBLER_OUTPUTS,
  MAX_ROM_DIMENSION,
  MIN_ROM_DIMENSION,
  snapshotComponentState,
  stateFromSnapshot,
  transformComponentSnapshot,
  validateComponentSnapshot,
  validateSignalLabel,
  type AssemblerComponentState,
  type ConfigurableComponentSnapshot,
  type ConfigurableComponentState,
  type MovementSensorComponentState,
  type RuneArrayComponentState,
} from "./configurable-components";
import { CellStorage } from "./cell-storage";
import { isCharge, type Charge } from "./circuit";
import { isProcessingMachine, processingRecipeFor } from "./furnace";
import { PuzzleResult } from "./puzzle-result";
import { recordProcessingAnimation } from "./processing-animation";
import { validateTextBoxes, type TextBox } from "./text-box";
import {
  requireRuneArrayDimension,
  validateRuneArrayDescription,
} from "./rune-array";
import {
  Direction,
  directionX,
  directionY,
  flipDirectionHorizontally,
  flipDirectionVertically,
  oppositeDirection,
  orientationForKind,
  orientedSides,
  TILE_DEFINITIONS,
  TileKind,
} from "./tile";
import { expectDefined } from "../util/assert";
import { WorldFeature, WorldFeatureIndex } from "./world-features";

export interface Tile {
  readonly kind: TileKind;
  readonly id: number;
}

export class World {
  readonly width: number;
  readonly height: number;
  readonly cellCount: number;

  private readonly cells: CellStorage;
  /** Scratch copy for moving or rotating many cells atomically. */
  private readonly movedCells: CellStorage;
  private readonly componentStates = new Map<number, ConfigurableComponentState>();
  private nextTileId = 1;
  private revisionValue = 0;
  private geometryRevisionValue = 0;
  private puzzleResultValue = PuzzleResult.InProgress;
  private textBoxesValue: readonly TextBox[] = Object.freeze([]);
  private readonly featureIndex: WorldFeatureIndex;

  constructor(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("World dimensions must be positive integers");
    }

    this.width = width;
    this.height = height;
    this.cellCount = width * height;
    this.cells = new CellStorage(this.cellCount);
    this.movedCells = new CellStorage(this.cellCount);
    this.featureIndex = new WorldFeatureIndex(this.cellCount);
  }

  /** Monotonically increases whenever this world's renderable state may have changed. */
  get revision(): number {
    return this.revisionValue;
  }

  /** Monotonically increases whenever this world's rendered body geometry may have changed. */
  get geometryRevision(): number {
    return this.geometryRevisionValue;
  }

  get textBoxes(): readonly TextBox[] {
    return this.textBoxesValue;
  }

  setTextBoxes(boxes: readonly TextBox[]): void {
    validateTextBoxes(boxes, this.width, this.height);
    this.textBoxesValue = Object.freeze(boxes.map((box) => Object.freeze({ ...box })));
    this.touchVisualRevision();
  }

  hasFeature(feature: WorldFeature): boolean {
    return this.featureIndex.has(feature);
  }

  firstFeatureIndex(feature: WorldFeature): number {
    return this.featureIndex.first(feature);
  }

  nextFeatureIndex(feature: WorldFeature, after: number): number {
    return this.featureIndex.next(feature, after);
  }

  lastFeatureIndex(feature: WorldFeature): number {
    return this.featureIndex.last(feature);
  }

  previousFeatureIndex(feature: WorldFeature, before: number): number {
    return this.featureIndex.previous(feature, before);
  }

  /**
   * Records an external visual-state change owned indirectly by this world, such as an
   * edit inside a rune array's inner board.
   */
  touchRevision(): void {
    this.touchVisualRevision();
  }

  private touchVisualRevision(): void {
    this.revisionValue += 1;
  }

  private touchGeometryRevision(): void {
    this.geometryRevisionValue += 1;
    this.touchVisualRevision();
  }

  get puzzleResult(): PuzzleResult {
    return this.puzzleResultValue;
  }

  markPuzzleResult(result: PuzzleResult.Won | PuzzleResult.Lost): void {
    if (this.puzzleResultValue === PuzzleResult.InProgress) {
      this.puzzleResultValue = result;
    }
  }

  resetPuzzleResult(): void {
    this.puzzleResultValue = PuzzleResult.InProgress;
  }

  kindAt(x: number, y: number): TileKind {
    return this.cells.kinds[this.indexOf(x, y)] as TileKind;
  }

  idAtIndex(index: number): number {
    this.assertIndex(index);
    return this.cells.ids[index] ?? 0;
  }

  idAt(x: number, y: number): number {
    return this.cells.ids[this.indexOf(x, y)] ?? 0;
  }
  orientationAt(x: number, y: number): Direction {
    return this.cells.orientations[this.indexOf(x, y)] as Direction;
  }

  chargeAt(x: number, y: number): Charge {
    const index = this.indexOf(x, y);
    if (this.cells.kinds[index] === TileKind.WireCrossing) {
      throw new Error("Wire crossing charges must be read from a circuit port");
    }
    if (this.cells.kinds[index] === TileKind.RuneArray) {
      throw new Error("Rune array charges must be read from a circuit port");
    }
    if (this.cells.kinds[index] === TileKind.MovementSensor) {
      throw new Error("Movement sensor charges must be read from a circuit port");
    }
    return this.cells.charges[index] as Charge;
  }

  tileAt(x: number, y: number): Tile {
    const index = this.indexOf(x, y);
    return {
      kind: this.cells.kinds[index] as TileKind,
      id: this.cells.ids[index] ?? 0,
    };
  }

  setCharge(x: number, y: number, charge: Charge): void {
    const index = this.indexOf(x, y);
    if (!isCharge(charge)) {
      throw new RangeError(`Invalid circuit charge ${charge as number}`);
    }
    const kind = this.cells.kinds[index] as TileKind;
    if (charge !== 0 && TILE_DEFINITIONS[kind].circuitPorts === 0) {
      throw new Error("Only circuit-connected tiles can hold a nonzero charge");
    }
    if (kind === TileKind.WireCrossing && charge !== 0) {
      throw new Error("Wire crossing charges must specify a circuit axis");
    }
    if (kind === TileKind.RuneArray && charge !== 0) {
      throw new Error("Rune array charges must specify a side port");
    }
    if (kind === TileKind.MovementSensor && charge !== 0) {
      throw new Error("Movement sensor charges must specify a side port");
    }
    if (
      this.cells.charges[index] !== charge ||
      (kind === TileKind.WireCrossing && this.cells.crossingVerticalCharges[index] !== 0)
    ) {
      this.cells.charges[index] = charge;
      this.cells.crossingVerticalCharges[index] = 0;
      this.touchVisualRevision();
    }
  }

  setCrossingCharges(x: number, y: number, horizontal: Charge, vertical: Charge): void {
    const index = this.indexOf(x, y);
    if (this.cells.kinds[index] !== TileKind.WireCrossing) {
      throw new Error(`Tile at (${x}, ${y}) is not a wire crossing`);
    }
    if (!isCharge(horizontal) || !isCharge(vertical)) {
      throw new RangeError("Invalid wire crossing charge");
    }
    if (
      this.cells.charges[index] !== horizontal ||
      this.cells.crossingVerticalCharges[index] !== vertical
    ) {
      this.cells.charges[index] = horizontal;
      this.cells.crossingVerticalCharges[index] = vertical;
      this.touchVisualRevision();
    }
  }
  setIsolatedOutputCharge(x: number, y: number, charge: Charge): void {
    const index = this.indexOf(x, y);
    const kind = this.cells.kinds[index] as TileKind;
    if (!hasSeparateIsolatedOutput(kind)) {
      throw new Error(`Tile at (${x}, ${y}) has no separate isolated output`);
    }
    if (!isCharge(charge)) {
      throw new RangeError(`Invalid isolated output charge ${charge as number}`);
    }
    if (this.cells.isolatedOutputCharges[index] !== charge) {
      this.cells.isolatedOutputCharges[index] = charge;
      this.touchVisualRevision();
    }
  }


  /**
   * Commits resolved circuit charges. `portCharges` holds four charges per cell in
   * direction order and is applied to rune arrays and movement sensors, whose side
   * outputs are stored on their component state instead of the shared per-cell charge.
   */
  applyCircuitCharges(
    charges: Int8Array,
    crossingVerticalCharges: Int8Array,
    isolatedOutputCharges: Int8Array,
    portCharges: Int8Array,
  ): void {
    if (
      charges.length !== this.cellCount ||
      crossingVerticalCharges.length !== this.cellCount ||
      isolatedOutputCharges.length !== this.cellCount ||
      portCharges.length !== this.cellCount * 4
    ) {
      throw new RangeError("Circuit charge buffers must match the world cell count");
    }

    let changed = false;
    for (
      let index = this.firstFeatureIndex(WorldFeature.Circuit);
      index >= 0;
      index = this.nextFeatureIndex(WorldFeature.Circuit, index)
    ) {
      const kind = this.cells.kinds[index] as TileKind;
      if (kind === TileKind.RuneArray || kind === TileKind.MovementSensor) {
        const state = kind === TileKind.RuneArray
          ? this.requireRuneArrayStateAtIndex(index)
          : this.movementSensorStateAtIndex(index);
        for (let side = 0; side < 4; side += 1) {
          const portCharge = expectDefined(portCharges[index * 4 + side], "component port charge");
          if (!isCharge(portCharge)) {
            throw new RangeError(`Invalid component port charge ${portCharge}`);
          }
          if (state.ports[side] !== portCharge) {
            state.ports[side] = portCharge;
            changed = true;
          }
        }
      }
      const charge = expectDefined(charges[index], "circuit charge");
      const verticalCharge = expectDefined(
        crossingVerticalCharges[index],
        "crossing vertical charge",
      );
      const isolatedOutputCharge = expectDefined(
        isolatedOutputCharges[index],
        "isolated output charge",
      );
      if (
        !isCharge(charge) ||
        !isCharge(verticalCharge) ||
        !isCharge(isolatedOutputCharge)
      ) {
        throw new RangeError(
          `Invalid circuit charges ${charge}, ${verticalCharge}, ${isolatedOutputCharge}`,
        );
      }
      if (
        charge !== 0 &&
        (TILE_DEFINITIONS[kind].circuitPorts === 0 ||
          kind === TileKind.RuneArray || kind === TileKind.MovementSensor)
      ) {
        throw new Error(`Tile at index ${index} cannot hold a shared charge`);
      }
      if (verticalCharge !== 0 && kind !== TileKind.WireCrossing) {
        throw new Error(`Non-crossing tile at index ${index} cannot hold vertical charge`);
      }
      if (
        isolatedOutputCharge !== 0 &&
        !hasSeparateIsolatedOutput(kind)
      ) {
        throw new Error(
          `Tile without a separate isolated output at index ${index} cannot hold its charge`,
        );
      }
      if (
        this.cells.charges[index] !== charge ||
        this.cells.crossingVerticalCharges[index] !== verticalCharge ||
        this.cells.isolatedOutputCharges[index] !== isolatedOutputCharge
      ) {
        this.cells.charges[index] = charge;
        this.cells.crossingVerticalCharges[index] = verticalCharge;
        this.cells.isolatedOutputCharges[index] = isolatedOutputCharge;
        changed = true;
      }
    }
    if (changed) {
      this.touchVisualRevision();
    }
  }
  componentStateSnapshotAt(
    x: number,
    y: number,
  ): ConfigurableComponentSnapshot | null {
    return this.componentStateSnapshotAtIndex(this.indexOf(x, y));
  }

  componentStateSnapshotAtIndex(index: number): ConfigurableComponentSnapshot | null {
    this.assertIndex(index);
    const kind = this.cells.kinds[index] as TileKind;
    if (!hasComponentState(kind)) {
      return null;
    }
    return snapshotComponentState(this.requireComponentStateAtIndex(index));
  }

  /** Mutable motion history and committed ports; callers must not retain it across edits. */
  movementSensorStateAtIndex(index: number): MovementSensorComponentState {
    this.assertIndex(index);
    if (this.cells.kinds[index] !== TileKind.MovementSensor) {
      throw new Error(`Tile at index ${index} is not a movement sensor`);
    }
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "movement-sensor") {
      throw new Error(`Movement sensor at index ${index} has mismatched component state`);
    }
    return state;
  }

  /** Advances unwelded gravity history; callers defer destruction until movement commits. */
  advanceFragileFallAtIndex(index: number, falling: boolean): boolean {
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "fragile") {
      throw new Error(`Tile at index ${index} is not fragile`);
    }
    const welded =
      this.hasWeldAtIndex(index, Direction.Up) ||
      this.hasWeldAtIndex(index, Direction.Right) ||
      this.hasWeldAtIndex(index, Direction.Down) ||
      this.hasWeldAtIndex(index, Direction.Left);
    const breaks = !welded && !falling && state.fallDistance > 1;
    const distance = welded || !falling ? 0 : Math.min(2, state.fallDistance + 1);
    if (state.fallDistance !== distance) {
      state.fallDistance = distance;
      this.touchVisualRevision();
    }
    return breaks;
  }

  configureNumericComponent(x: number, y: number, value: number): boolean {
    const index = this.indexOf(x, y);
    const state = this.requireComponentStateAtIndex(index);
    const configuration = componentConfigurationForKind(this.cells.kinds[index] as TileKind);
    if (configuration === null || configuration.type !== "number") {
      throw new Error(`Tile at (${x}, ${y}) does not have numeric configuration`);
    }
    if (
      !Number.isInteger(value) ||
      value < configuration.minimum ||
      value > configuration.maximum
    ) {
      throw new RangeError(
        `${configuration.label} must be an integer from ` +
        `${configuration.minimum} through ${configuration.maximum}`,
      );
    }

    if (state.type === "delay") {
      if (state.length === value) {
        return false;
      }
      state.length = value;
      state.cursor = 0;
      state.data = new Int8Array(value);
    } else if (state.type === "discard") {
      if (state.length === value) {
        return false;
      }
      state.length = value;
      state.discarded = 0;
    } else if (state.type === "counter") {
      if (state.threshold === value) {
        return false;
      }
      state.threshold = value;
      state.count = 0;
    } else {
      throw new Error(`Tile at (${x}, ${y}) does not have numeric configuration`);
    }
    this.cells.charges[index] = 0;
    this.touchVisualRevision();
    return true;
  }

  /** Replaces a ternary value grid, clearing its output and any sequence/cursor progress. */
  configureTernaryGrid(
    x: number,
    y: number,
    width: number,
    height: number,
    values: readonly Charge[],
    { ignoreZeros = false, wrapX = true, wrapY = true }: {
      readonly ignoreZeros?: boolean;
      readonly wrapX?: boolean;
      readonly wrapY?: boolean;
    } = {},
  ): boolean {
    const index = this.indexOf(x, y);
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "rom" && state.type !== "lut" && state.type !== "checker") {
      throw new Error(`Tile at (${x}, ${y}) does not have a ternary value grid`);
    }
    if (state.type === "lut" && (width !== LUT_DIMENSION || height !== LUT_DIMENSION)) {
      throw new RangeError(`Lookup grid dimensions must be exactly ${LUT_DIMENSION} by ${LUT_DIMENSION}`);
    }
    if (
      !Number.isInteger(width) ||
      width < MIN_ROM_DIMENSION ||
      width > MAX_ROM_DIMENSION ||
      !Number.isInteger(height) ||
      height < MIN_ROM_DIMENSION ||
      height > MAX_ROM_DIMENSION
    ) {
      throw new RangeError(
        `Grid dimensions must be integers from ${MIN_ROM_DIMENSION} through ${MAX_ROM_DIMENSION}`,
      );
    }
    if (values.length !== width * height) {
      throw new RangeError(`Grid values must contain exactly ${width * height} charges`);
    }
    for (const value of values) {
      if (!isCharge(value)) {
        throw new RangeError(`Grid contains invalid charge ${value as number}`);
      }
    }
    if (typeof ignoreZeros !== "boolean" || (ignoreZeros && state.type !== "checker")) {
      throw new RangeError("Ignore zeros is a boolean option for sequence checkers only");
    }
    if (ignoreZeros && values.includes(0)) {
      throw new RangeError("A checker that ignores zeros must expect only +1 and -1 values");
    }
    if (
      typeof wrapX !== "boolean" || typeof wrapY !== "boolean" ||
      (state.type !== "rom" && (!wrapX || !wrapY))
    ) {
      throw new RangeError("Wrapping flags are boolean options for lore runes only");
    }
    let changed = state.width !== width || state.height !== height ||
      (state.type === "checker" && state.ignoreZeros !== ignoreZeros) ||
      (state.type === "rom" && (state.wrapX !== wrapX || state.wrapY !== wrapY));
    if (!changed) {
      for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
        if (state.values[valueIndex] !== values[valueIndex]) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) {
      return false;
    }
    state.width = width;
    state.height = height;
    if (state.type !== "lut") {
      state.cursor = 0;
    }
    state.values = Int8Array.from(values);
    if (state.type === "checker") {
      state.failed = false;
      state.ignoreZeros = ignoreZeros;
    }
    if (state.type === "rom") {
      state.wrapX = wrapX;
      state.wrapY = wrapY;
    }
    this.cells.charges[index] = 0;
    this.touchVisualRevision();
    return true;
  }

  /** Live inner board of the rune array at `index`; callers must not retain it across edits. */
  runeArrayWorldAtIndex(index: number): World {
    return this.requireRuneArrayStateAtIndex(index).world;
  }

  runeArrayWorldAt(x: number, y: number): World {
    return this.runeArrayWorldAtIndex(this.indexOf(x, y));
  }

  /**
   * Resizes a rune array's inner board, keeping existing contents centered so the
   * edge-center ports stay on the same centerlines, and updates its description.
   * Returns whether anything changed.
   */
  configureRuneArray(
    x: number,
    y: number,
    width: number,
    height: number,
    description: string,
  ): boolean {
    const index = this.indexOf(x, y);
    const state = this.requireRuneArrayStateAtIndex(index);
    requireRuneArrayDimension(width, "Rune array width");
    requireRuneArrayDimension(height, "Rune array height");
    validateRuneArrayDescription(description);
    let changed = false;
    if (state.description !== description) {
      state.description = description;
      changed = true;
    }
    if (state.world.width !== width || state.world.height !== height) {
      const previous = state.world;
      const next = new World(width, height);
      next.copyCenteredFrom(previous);
      state.world = next;
      state.ports.fill(0);
      changed = true;
    }
    if (changed) {
      this.touchVisualRevision();
    }
    return changed;
  }

  configureSignalLabel(x: number, y: number, label: string, category: string): boolean {
    const index = this.indexOf(x, y);
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "monitor" && state.type !== "grapher") {
      throw new Error(`Tile at (${x}, ${y}) does not have a signal name`);
    }
    validateSignalLabel(label);
    validateSignalLabel(category);
    if (state.label === label && state.category === category) {
      return false;
    }
    state.label = label;
    state.category = category;
    this.touchVisualRevision();
    return true;
  }

  /** Updates a signal's display order without changing simulation geometry. */
  configureSignalOrder(x: number, y: number, order: number): boolean {
    const index = this.indexOf(x, y);
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "monitor" && state.type !== "grapher") {
      throw new Error(`Tile at (${x}, ${y}) does not have a signal order`);
    }
    if (!Number.isSafeInteger(order)) {
      throw new RangeError("Signal order must be a safe integer");
    }
    if (state.order === order) {
      return false;
    }
    state.order = order;
    this.touchVisualRevision();
    return true;
  }

  restoreComponentState(
    x: number,
    y: number,
    snapshot: ConfigurableComponentSnapshot,
  ): void {
    const index = this.indexOf(x, y);
    const kind = this.cells.kinds[index] as TileKind;
    validateComponentSnapshot(snapshot);
    if (!componentStateMatchesKind(snapshot, kind)) {
      throw new Error(`Component state at (${x}, ${y}) does not match ${TILE_DEFINITIONS[kind].name}`);
    }
    if (
      snapshot.type === "rotator" &&
      snapshot.direction === oppositeDirection(this.orientationAtIndex(index))
    ) {
      throw new Error(`Rotator at (${x}, ${y}) cannot point toward its rear input`);
    }
    const id = this.cells.ids[index] ?? 0;
    if (id === 0) {
      throw new Error(`Configurable component at (${x}, ${y}) has no tile identity`);
    }
    this.componentStates.set(id, stateFromSnapshot(snapshot));
    this.touchVisualRevision();
  }

  rotatorDirectionAtIndex(index: number): Direction {
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "rotator") {
      throw new Error(`Tile at index ${index} is not a rotator`);
    }
    return state.direction;
  }

  setRotatorDirectionAtIndex(index: number, direction: Direction): void {
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "rotator") {
      throw new Error(`Tile at index ${index} is not a rotator`);
    }
    const orientation = this.orientationAtIndex(index);
    if (direction === oppositeDirection(orientation)) {
      throw new Error(`Rotator at index ${index} cannot point toward its rear input`);
    }
    if (state.direction !== direction) {
      state.direction = direction;
      this.touchVisualRevision();
    }
  }

  advanceDelayAtIndex(index: number, input: Charge): Charge {
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "delay") {
      throw new Error(`Tile at index ${index} is not a delay`);
    }
    const output = state.data[state.cursor] as Charge;
    const changed = state.length > 1 || output !== input;
    state.data[state.cursor] = input;
    state.cursor = (state.cursor + 1) % state.length;
    if (changed) {
      this.touchVisualRevision();
    }
    return output;
  }

  advanceDiscardAtIndex(index: number, input: Charge): Charge {
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "discard") {
      throw new Error(`Tile at index ${index} is not a discard`);
    }
    if (state.discarded < state.length) {
      state.discarded += 1;
      this.touchVisualRevision();
      return 0;
    }
    return input;
  }

  advanceCounterAtIndex(index: number, input: Charge): Charge {
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "counter") {
      throw new Error(`Tile at index ${index} is not a counter`);
    }
    if (input === 0) {
      return 0;
    }
    const nextCount = state.count + input;
    let output: Charge = 0;
    if (nextCount < 0) {
      state.count = state.threshold - 1;
      output = -1;
    } else if (nextCount >= state.threshold) {
      state.count = 0;
      output = 1;
    } else {
      state.count = nextCount;
    }
    this.touchVisualRevision();
    return output;
  }

  advanceRomAtIndex(index: number, cursorDeltaX: number, cursorDeltaY: number): Charge {
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "rom") {
      throw new Error(`Tile at index ${index} is not a ROM`);
    }
    const cellCount = state.values.length;
    const column = state.cursor % state.width;
    const horizontalCursor = state.cursor + cursorDeltaX;
    // Reject the entire horizontal move if its step or carry crosses a disabled edge.
    const horizontalBlocked =
      (!state.wrapX && (column + cursorDeltaX < 0 || column + cursorDeltaX >= state.width)) ||
      (!state.wrapY && (horizontalCursor < 0 || horizontalCursor >= cellCount));
    let nextCursor = horizontalBlocked
      ? state.cursor
      : (horizontalCursor + cellCount) % cellCount;
    if (cursorDeltaY !== 0) {
      const column = nextCursor % state.width;
      const row = (nextCursor - column) / state.width;
      const columnMajorCursor = column * state.height + row;
      const verticalCursor = columnMajorCursor + cursorDeltaY;
      const verticalBlocked =
        (!state.wrapY && (row + cursorDeltaY < 0 || row + cursorDeltaY >= state.height)) ||
        (!state.wrapX && (verticalCursor < 0 || verticalCursor >= cellCount));
      if (!verticalBlocked) {
        const nextColumnMajorCursor = (verticalCursor + cellCount) % cellCount;
        const nextColumn = Math.floor(nextColumnMajorCursor / state.height);
        const nextRow = nextColumnMajorCursor % state.height;
        nextCursor = nextRow * state.width + nextColumn;
      }
    }
    if (nextCursor !== state.cursor) {
      state.cursor = nextCursor;
      this.touchVisualRevision();
    }
    return state.values[state.cursor] as Charge;
  }

  /** Reads the logical truth table without moving a cursor or allocating a snapshot. */
  lookupLutAtIndex(index: number, leftInput: Charge, rearInput: Charge): Charge {
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "lut") {
      throw new Error(`Tile at index ${index} is not a lookup rune`);
    }
    return state.values[(rearInput + 1) * LUT_DIMENSION + leftInput + 1] as Charge;
  }

  /**
   * Advances a sequence checker with the rear input observed this tick and returns its
   * verdict: 0 while waiting or matching, +1 once every value matched, -1 after a mismatch.
   */
  advanceCheckerAtIndex(index: number, input: Charge): Charge {
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "checker") {
      throw new Error(`Tile at index ${index} is not a sequence checker`);
    }
    if (state.failed) {
      return -1;
    }
    const valueCount = state.values.length;
    if (state.cursor >= valueCount) {
      return 1;
    }
    if (input === 0 && (state.cursor === 0 || state.ignoreZeros)) {
      return 0;
    }
    if (state.values[state.cursor] !== input) {
      state.failed = true;
      this.touchVisualRevision();
      return -1;
    }
    state.cursor += 1;
    this.touchVisualRevision();
    return state.cursor === valueCount ? 1 : 0;
  }

  furnaceProgressAt(x: number, y: number): number {
    return this.cells.furnaceProgress[this.indexOf(x, y)] ?? 0;
  }

  furnaceProgressAtIndex(index: number): number {
    this.assertIndex(index);
    return this.cells.furnaceProgress[index] ?? 0;
  }

  furnaceTargetIdAtIndex(index: number): number {
    this.assertIndex(index);
    return this.cells.furnaceTargetIds[index] ?? 0;
  }

  restoreFurnaceProgress(x: number, y: number, progress: number): void {
    const index = this.indexOf(x, y);
    const kind = this.kindAtIndex(index);
    if (!isProcessingMachine(kind)) {
      throw new Error(`Tile at (${x}, ${y}) is not a processing machine`);
    }
    const targetIndex = this.directionalNeighborIndex(index);
    const targetKind = targetIndex < 0
      ? TileKind.Empty
      : this.cells.kinds[targetIndex] as TileKind;
    const recipe = processingRecipeFor(kind, targetKind);
    if (recipe === undefined) {
      throw new Error(`Processing machine at (${x}, ${y}) has no processable target`);
    }
    if (!Number.isSafeInteger(progress) || progress <= 0 || progress >= recipe.bakeTime) {
      throw new RangeError(
        `Furnace progress must be between 1 and ${recipe.bakeTime - 1} ticks`,
      );
    }
    const targetId = this.cells.ids[targetIndex] ?? 0;
    if (targetId === 0) {
      throw new Error(`Furnace at (${x}, ${y}) has no target identity`);
    }
    this.cells.furnaceProgress[index] = progress;
    this.cells.furnaceTargetIds[index] = targetId;
    this.touchVisualRevision();
  }

  /** Drill commits reuse processing storage so movement, snapshots, and copies retain progress. */
  applyDrillProgress(index: number, progress: number, targetId: number): void {
    this.assertIndex(index);
    if (this.kindAtIndex(index) !== TileKind.Drill) {
      throw new Error(`Tile at index ${index} is not a drill`);
    }
    const target = this.directionalNeighborIndex(index);
    const recipe = target < 0 ? undefined : processingRecipeFor(TileKind.Drill, this.kindAtIndex(target));
    if (!Number.isInteger(progress) || progress < 0 ||
        (progress === 0 ? targetId !== 0 :
          recipe === undefined || progress >= recipe.bakeTime || targetId === 0 || this.idAtIndex(target) !== targetId)) {
      throw new Error(`Drill at index ${index} has inconsistent progress state`);
    }
    if (this.cells.furnaceProgress[index] === progress && this.cells.furnaceTargetIds[index] === targetId) return;
    this.cells.furnaceProgress[index] = progress;
    this.cells.furnaceTargetIds[index] = targetId;
    this.touchVisualRevision();
  }

  applyFurnaceResults(
    progresses: Uint16Array,
    targetIds: Uint32Array,
    transformTargetIndices: Int32Array,
    transformKinds: Uint8Array,
  ): void {
    if (
      progresses.length !== this.cellCount ||
      targetIds.length !== this.cellCount ||
      transformTargetIndices.length !== this.cellCount ||
      transformKinds.length !== this.cellCount
    ) {
      throw new RangeError("Furnace result buffers must match the world cell count");
    }

    let changed = false;
    let geometryChanged = false;
    for (
      let index = this.firstFeatureIndex(WorldFeature.Furnace);
      index >= 0;
      index = this.nextFeatureIndex(WorldFeature.Furnace, index)
    ) {
      const progress = expectDefined(progresses[index], "next furnace progress");
      const targetId = expectDefined(targetIds[index], "next furnace target ID");
      const willTransform = expectDefined(
        transformTargetIndices[index],
        "furnace transform target",
      ) >= 0;
      if (
        (progress === 0 && targetId !== 0 && !willTransform) ||
        (progress !== 0 && targetId === 0)
      ) {
        throw new Error(`Furnace at index ${index} has inconsistent progress state`);
      }
      const storedTargetId = progress === 0 ? 0 : targetId;
      if (
        this.cells.furnaceProgress[index] !== progress ||
        this.cells.furnaceTargetIds[index] !== storedTargetId
      ) {
        this.cells.furnaceProgress[index] = progress;
        this.cells.furnaceTargetIds[index] = storedTargetId;
        changed = true;
      }
    }

    for (
      let index = this.firstFeatureIndex(WorldFeature.Furnace);
      index >= 0;
      index = this.nextFeatureIndex(WorldFeature.Furnace, index)
    ) {
      const targetIndex = expectDefined(
        transformTargetIndices[index],
        "furnace transform target",
      );
      if (targetIndex < 0) {
        continue;
      }
      this.assertIndex(targetIndex);
      const targetId = expectDefined(targetIds[index], "transform target ID");
      if (targetId === 0 || this.cells.ids[targetIndex] !== targetId) {
        throw new Error(`Furnace at index ${index} lost its transform target`);
      }
      const outputKind = expectDefined(
        transformKinds[index],
        "furnace transform kind",
      ) as TileKind;
      if (outputKind === TileKind.Empty || TILE_DEFINITIONS[outputKind] === undefined) {
        throw new Error(`Furnace at index ${index} has invalid output kind ${outputKind}`);
      }
      const transformedId = this.cells.ids[targetIndex] ?? 0;
      if (transformedId !== 0) {
        this.componentStates.delete(transformedId);
      }
      this.replaceKindAtIndex(targetIndex, outputKind);
      this.cells.orientations[targetIndex] = Direction.Up;
      this.cells.resetTransientState(targetIndex);
      const state = createDefaultComponentState(
        outputKind,
        Direction.Up,
        (width, height) => new World(width, height),
      );
      if (state !== null) {
        this.componentStates.set(targetId, state);
      }
      this.clearDisallowedWeldsAtIndex(targetIndex);
      recordProcessingAnimation(this, targetIndex, outputKind);
      changed = true;
      geometryChanged = true;
    }

    if (geometryChanged) {
      this.touchGeometryRevision();
    } else if (changed) {
      this.touchVisualRevision();
    }
  }

  /** Number of outputs an assembler still has to emit. */
  assemblerPendingCountAtIndex(index: number): number {
    const state = this.requireAssemblerStateAtIndex(index);
    return state.pendingKinds.length - state.cursor;
  }

  /**
   * Commits one assembler phase. Each assembler with a consume target atomically removes
   * every cell owned by it in `bodyOwners` and replaces its empty queue with the
   * `queuedCounts[assembler]` outputs stored at `assembler * MAX_ASSEMBLER_OUTPUTS` in the
   * queued buffers. Each assembler with an emit target then places its next queued output
   * there with a fresh identity and no welds. Callers resolve conflicts beforehand; any
   * inconsistency here is an error.
   */
  applyAssemblerResults(
    consumeTargetIndices: Int32Array,
    bodyOwners: Int32Array,
    queuedCounts: Uint8Array,
    queuedKinds: Uint8Array,
    queuedOrientations: Uint8Array,
    emitTargetIndices: Int32Array,
  ): void {
    if (
      consumeTargetIndices.length !== this.cellCount ||
      bodyOwners.length !== this.cellCount ||
      queuedCounts.length !== this.cellCount ||
      queuedKinds.length !== this.cellCount * MAX_ASSEMBLER_OUTPUTS ||
      queuedOrientations.length !== this.cellCount * MAX_ASSEMBLER_OUTPUTS ||
      emitTargetIndices.length !== this.cellCount
    ) {
      throw new RangeError("Assembler buffers must match the world cell count");
    }

    let changed = false;
    for (
      let assembler = this.firstFeatureIndex(WorldFeature.Assembler);
      assembler >= 0;
      assembler = this.nextFeatureIndex(WorldFeature.Assembler, assembler)
    ) {
      const target = expectDefined(consumeTargetIndices[assembler], "assembler consume target");
      if (target < 0) {
        continue;
      }
      this.assertIndex(target);
      if (this.cells.kinds[assembler] !== TileKind.Assembler) {
        throw new Error(`Non-assembler tile at index ${assembler} cannot consume a body`);
      }
      const state = this.requireAssemblerStateAtIndex(assembler);
      if (state.cursor < state.pendingKinds.length) {
        throw new Error(`Assembler at index ${assembler} consumed while outputs were pending`);
      }
      const outputCount = expectDefined(queuedCounts[assembler], "assembler queued count");
      if (outputCount < 1 || outputCount > MAX_ASSEMBLER_OUTPUTS) {
        throw new RangeError(`Assembler at index ${assembler} queues ${outputCount} outputs`);
      }
      if (this.cells.kinds[target] === TileKind.Empty || bodyOwners[target] !== assembler) {
        throw new Error(`Assembler at index ${assembler} lost its input body`);
      }
      let removed = 0;
      for (let index = 0; index < this.cellCount; index += 1) {
        if (bodyOwners[index] !== assembler) {
          continue;
        }
        if (this.cells.kinds[index] === TileKind.Empty) {
          throw new Error(`Assembler at index ${assembler} has an empty body member`);
        }
        this.clearIndex(index);
        removed += 1;
      }
      if (removed === 0) {
        throw new Error(`Assembler at index ${assembler} consumed no cells`);
      }
      const base = assembler * MAX_ASSEMBLER_OUTPUTS;
      state.pendingKinds = queuedKinds.slice(base, base + outputCount);
      state.pendingOrientations = queuedOrientations.slice(base, base + outputCount);
      state.cursor = 0;
      for (let slot = 0; slot < outputCount; slot += 1) {
        const kind = state.pendingKinds[slot] as TileKind;
        if (kind === TileKind.Empty || TILE_DEFINITIONS[kind] === undefined) {
          throw new Error(`Assembler at index ${assembler} queued invalid tile kind ${kind}`);
        }
        state.pendingOrientations[slot] = orientationForKind(
          kind,
          state.pendingOrientations[slot] as Direction,
        );
      }
      changed = true;
    }

    for (
      let assembler = this.firstFeatureIndex(WorldFeature.Assembler);
      assembler >= 0;
      assembler = this.nextFeatureIndex(WorldFeature.Assembler, assembler)
    ) {
      const target = expectDefined(emitTargetIndices[assembler], "assembler emit target");
      if (target < 0) {
        continue;
      }
      this.assertIndex(target);
      if (this.cells.kinds[assembler] !== TileKind.Assembler) {
        throw new Error(`Non-assembler tile at index ${assembler} cannot emit an output`);
      }
      if (this.cells.kinds[target] !== TileKind.Empty) {
        throw new Error(`Assembler output cell at index ${target} is occupied`);
      }
      const state = this.requireAssemblerStateAtIndex(assembler);
      if (state.cursor >= state.pendingKinds.length) {
        throw new Error(`Assembler at index ${assembler} has nothing to emit`);
      }
      const kind = state.pendingKinds[state.cursor] as TileKind;
      const orientation = state.pendingOrientations[state.cursor] as Direction;
      state.cursor += 1;
      const targetX = target % this.width;
      const targetY = (target - targetX) / this.width;
      this.place(targetX, targetY, kind, orientation);
      changed = true;
    }

    if (changed) {
      this.touchGeometryRevision();
    }
  }

  applyDeliveryAbsorptions(
    targetIndices: Int32Array,
    bodyOwners: Int32Array,
  ): void {
    if (
      targetIndices.length !== this.cellCount ||
      bodyOwners.length !== this.cellCount
    ) {
      throw new RangeError("Delivery buffers must match the world cell count");
    }

    for (
      let delivery = this.firstFeatureIndex(WorldFeature.Delivery);
      delivery >= 0;
      delivery = this.nextFeatureIndex(WorldFeature.Delivery, delivery)
    ) {
      const target = expectDefined(targetIndices[delivery], "delivery target index");
      if (target < 0) {
        continue;
      }
      this.assertIndex(target);
      if (this.cells.kinds[delivery] !== TileKind.Delivery) {
        throw new Error(`Non-delivery tile at index ${delivery} cannot absorb a body`);
      }
      if (
        this.cells.kinds[target] === TileKind.Empty ||
        bodyOwners[target] !== delivery
      ) {
        throw new Error(`Delivery box at index ${delivery} lost its absorption body`);
      }
    }

    let removedCellCount = 0;
    for (let index = 0; index < this.cellCount; index += 1) {
      const delivery = expectDefined(bodyOwners[index], "absorbed body owner");
      if (delivery < 0) {
        continue;
      }
      this.assertIndex(delivery);
      if (
        expectDefined(targetIndices[delivery], "absorbing delivery target") < 0 ||
        this.cells.kinds[index] === TileKind.Empty
      ) {
        throw new Error(`Delivery box at index ${delivery} has an invalid body member`);
      }
      removedCellCount += 1;
    }
    if (removedCellCount === 0) {
      return;
    }
    for (let index = 0; index < this.cellCount; index += 1) {
      if (expectDefined(bodyOwners[index], "absorbed body owner") >= 0) {
        this.clearIndex(index);
      }
    }
    this.touchGeometryRevision();
  }

  applyDuplications(
    sourceForDestination: Int32Array,
    destinationOwners: Int32Array,
  ): void {
    if (
      sourceForDestination.length !== this.cellCount ||
      destinationOwners.length !== this.cellCount
    ) {
      throw new RangeError("Duplicator buffers must match the world cell count");
    }

    let duplicateCount = 0;
    for (let destination = 0; destination < this.cellCount; destination += 1) {
      const source = expectDefined(
        sourceForDestination[destination],
        "duplicator source index",
      );
      if (source === -1) {
        continue;
      }
      const owner = expectDefined(
        destinationOwners[destination],
        "duplicator destination owner",
      );
      if (source < 0 || source >= this.cellCount) {
        throw new RangeError(`Invalid duplicator source index ${source}`);
      }
      if (
        owner < 0 ||
        owner >= this.cellCount ||
        this.cells.kinds[owner] !== TileKind.Duplicator
      ) {
        throw new Error(`Invalid duplicator owner ${owner} for destination ${destination}`);
      }
      if (this.cells.kinds[source] === TileKind.Empty) {
        throw new Error(`Duplicator source at index ${source} is empty`);
      }
      if (this.cells.kinds[destination] !== TileKind.Empty) {
        throw new Error(`Duplicator destination at index ${destination} is occupied`);
      }
      const sourceX = source % this.width;
      const sourceY = (source - sourceX) / this.width;
      const destinationX = destination % this.width;
      const destinationY = (destination - destinationX) / this.width;
      const ownerX = owner % this.width;
      const ownerY = (owner - ownerX) / this.width;
      const ownerOrientation = this.cells.orientations[owner] as Direction;
      const validReflection = ownerOrientation === Direction.Up ||
          ownerOrientation === Direction.Down
        ? sourceX === destinationX && sourceY + destinationY === ownerY * 2
        : sourceY === destinationY && sourceX + destinationX === ownerX * 2;
      if (!validReflection) {
        throw new Error(
          `Duplicator ${owner} does not mirror source ${source} to destination ${destination}`,
        );
      }
      duplicateCount += 1;
    }
    if (duplicateCount === 0) {
      return;
    }

    for (let destination = 0; destination < this.cellCount; destination += 1) {
      const source = expectDefined(
        sourceForDestination[destination],
        "committed duplicator source index",
      );
      if (source < 0) {
        continue;
      }
      const owner = expectDefined(
        destinationOwners[destination],
        "committed duplicator destination owner",
      );
      const kind = this.cells.kinds[source] as TileKind;
      const sourceOrientation = this.cells.orientations[source] as Direction;
      const ownerOrientation = this.cells.orientations[owner] as Direction;
      const mirrorVertically = ownerOrientation === Direction.Up ||
        ownerOrientation === Direction.Down;
      const id = this.nextTileId;
      this.nextTileId += 1;
      this.replaceKindAtIndex(destination, kind);
      this.cells.ids[destination] = id;
      this.cells.orientations[destination] = orientationForKind(
        kind,
        mirrorVertically
          ? flipDirectionVertically(sourceOrientation)
          : flipDirectionHorizontally(sourceOrientation),
      );
      this.cells.charges[destination] = expectDefined(
        this.cells.charges[source],
        "duplicated tile charge",
      );
      this.cells.crossingVerticalCharges[destination] = expectDefined(
        this.cells.crossingVerticalCharges[source],
        "duplicated crossing charge",
      );
      this.cells.isolatedOutputCharges[destination] = expectDefined(
        this.cells.isolatedOutputCharges[source],
        "duplicated isolated output charge",
      );
      this.cells.furnaceProgress[destination] = 0;
      this.cells.furnaceTargetIds[destination] = 0;
      if (hasComponentState(kind)) {
        const snapshot = snapshotComponentState(this.requireComponentStateAtIndex(source));
        this.componentStates.set(
          id,
          stateFromSnapshot(
            transformComponentSnapshot(snapshot, 0, !mirrorVertically, mirrorVertically),
          ),
        );
      }
    }

    for (let destination = 0; destination < this.cellCount; destination += 1) {
      const source = expectDefined(
        sourceForDestination[destination],
        "duplicated furnace source index",
      );
      if (source < 0 || !isProcessingMachine(this.kindAtIndex(source))) {
        continue;
      }
      const progress = expectDefined(
        this.cells.furnaceProgress[source],
        "duplicated furnace progress",
      );
      if (progress === 0) {
        continue;
      }
      const sourceTarget = this.neighborIndex(
        source,
        this.cells.orientations[source] as Direction,
      );
      const destinationTarget = this.neighborIndex(
        destination,
        this.cells.orientations[destination] as Direction,
      );
      if (sourceTarget < 0 || destinationTarget < 0) {
        continue;
      }
      const owner = expectDefined(
        destinationOwners[destination],
        "duplicated furnace destination owner",
      );
      if (
        expectDefined(
          sourceForDestination[destinationTarget],
          "duplicated furnace target source",
        ) === sourceTarget &&
        expectDefined(
          destinationOwners[destinationTarget],
          "duplicated furnace target owner",
        ) === owner &&
        this.cells.furnaceTargetIds[source] === this.cells.ids[sourceTarget]
      ) {
        this.cells.furnaceProgress[destination] = progress;
        this.cells.furnaceTargetIds[destination] = expectDefined(
          this.cells.ids[destinationTarget],
          "duplicated furnace target ID",
        );
      }
    }

    for (let destination = 0; destination < this.cellCount; destination += 1) {
      const source = expectDefined(
        sourceForDestination[destination],
        "duplicated weld source index",
      );
      if (source < 0) {
        continue;
      }
      const owner = expectDefined(
        destinationOwners[destination],
        "duplicated weld destination owner",
      );
      if (destination % this.width < this.width - 1) {
        const rightSource = expectDefined(
          sourceForDestination[destination + 1],
          "right duplicated weld source index",
        );
        if (
          rightSource >= 0 &&
          expectDefined(
            destinationOwners[destination + 1],
            "right duplicated weld destination owner",
          ) === owner &&
          this.areWeldedAtIndices(source, rightSource)
        ) {
          this.cells.rightWelds[destination] = 1;
        }
      }
      if (destination < this.cellCount - this.width) {
        const downSource = expectDefined(
          sourceForDestination[destination + this.width],
          "down duplicated weld source index",
        );
        if (
          downSource >= 0 &&
          expectDefined(
            destinationOwners[destination + this.width],
            "down duplicated weld destination owner",
          ) === owner &&
          this.areWeldedAtIndices(source, downSource)
        ) {
          this.cells.downWelds[destination] = 1;
        }
      }
    }
    this.touchGeometryRevision();
  }

  isWelded(x1: number, y1: number, x2: number, y2: number): boolean {
    const first = this.indexOf(x1, y1);
    const second = this.indexOf(x2, y2);
    const storage = this.weldStorage(first, second);
    return storage.welds[storage.index] === 1;
  }

  canWeld(x1: number, y1: number, x2: number, y2: number): boolean {
    const first = this.indexOf(x1, y1);
    const second = this.indexOf(x2, y2);
    this.weldStorage(first, second);
    return this.canWeldIndices(first, second);
  }

  setWeld(x1: number, y1: number, x2: number, y2: number, welded: boolean): boolean {
    const first = this.indexOf(x1, y1);
    const second = this.indexOf(x2, y2);
    const storage = this.weldStorage(first, second);

    if (welded && !this.canWeldIndices(first, second)) {
      return false;
    }

    const value = welded ? 1 : 0;
    if (storage.welds[storage.index] === value) {
      return false;
    }
    storage.welds[storage.index] = value;
    this.touchGeometryRevision();
    return true;
  }
  weldEligibleNeighbors(x: number, y: number): boolean {
    const index = this.indexOf(x, y);
    let changed = false;

    if (
      x > 0 &&
      this.cells.rightWelds[index - 1] === 0 &&
      this.canWeldIndices(index - 1, index)
    ) {
      this.cells.rightWelds[index - 1] = 1;
      changed = true;
    }
    if (
      x < this.width - 1 &&
      this.cells.rightWelds[index] === 0 &&
      this.canWeldIndices(index, index + 1)
    ) {
      this.cells.rightWelds[index] = 1;
      changed = true;
    }
    if (
      y > 0 &&
      this.cells.downWelds[index - this.width] === 0 &&
      this.canWeldIndices(index - this.width, index)
    ) {
      this.cells.downWelds[index - this.width] = 1;
      changed = true;
    }
    if (
      y < this.height - 1 &&
      this.cells.downWelds[index] === 0 &&
      this.canWeldIndices(index, index + this.width)
    ) {
      this.cells.downWelds[index] = 1;
      changed = true;
    }

    if (changed) {
      this.touchGeometryRevision();
    }
    return changed;
  }


  hasCircuitConnectionAtIndex(index: number, direction: Direction): boolean {
    this.assertIndex(index);
    const x = index % this.width;
    let neighbor: number;
    let welded: boolean;
    switch (direction) {
      case Direction.Up:
        if (index < this.width) {
          return false;
        }
        neighbor = index - this.width;
        welded = this.cells.downWelds[neighbor] === 1;
        break;
      case Direction.Right:
        if (x >= this.width - 1) {
          return false;
        }
        neighbor = index + 1;
        welded = this.cells.rightWelds[index] === 1;
        break;
      case Direction.Down:
        if (index >= this.cellCount - this.width) {
          return false;
        }
        neighbor = index + this.width;
        welded = this.cells.downWelds[index] === 1;
        break;
      case Direction.Left:
        if (x === 0) {
          return false;
        }
        neighbor = index - 1;
        welded = this.cells.rightWelds[neighbor] === 1;
        break;
      default:
        throw new RangeError(`Invalid circuit direction ${direction as number}`);
    }
    if (!welded) {
      return false;
    }

    const ownDefinition = TILE_DEFINITIONS[this.cells.kinds[index] as TileKind];
    const neighborDefinition = TILE_DEFINITIONS[this.cells.kinds[neighbor] as TileKind];
    const ownPorts = orientedSides(ownDefinition.circuitPorts, this.cells.orientations[index] as Direction);
    const neighborPorts = orientedSides(
      neighborDefinition.circuitPorts,
      this.cells.orientations[neighbor] as Direction,
    );
    return (
      (ownPorts & (1 << direction)) !== 0 &&
      (neighborPorts & (1 << oppositeDirection(direction))) !== 0
    );
  }


  place(
    x: number,
    y: number,
    kind: TileKind,
    orientation: Direction = Direction.Up,
  ): number {
    const index = this.indexOf(x, y);
    if (!Number.isInteger(orientation) || orientation < Direction.Up || orientation > Direction.Left) {
      throw new RangeError(`Invalid tile orientation ${orientation}`);
    }
    if (kind === TileKind.Empty) {
      if (this.cells.kinds[index] === TileKind.Empty) {
        return 0;
      }
      this.clearIndex(index);
      this.touchGeometryRevision();
      return 0;
    }

    if (this.cells.kinds[index] === kind) {
      if (this.cells.orientations[index] !== orientation) {
        if (this.cells.kinds[index] === TileKind.Rotator) {
          const state = this.requireComponentStateAtIndex(index);
          if (state.type !== "rotator") {
            throw new Error(`Rotator at index ${index} has invalid component state`);
          }
          const turns = (orientation - (this.cells.orientations[index] as Direction) + 4) & 3;
          state.direction = ((state.direction + turns) & 3) as Direction;
        }
        this.cells.orientations[index] = orientation;
        this.cells.resetTransientState(index);
        this.clearDisallowedWeldsAtIndex(index);
        this.touchGeometryRevision();
      }
      return this.cells.ids[index] ?? 0;
    }
    const replacedId = this.cells.ids[index] ?? 0;
    if (replacedId !== 0) {
      this.componentStates.delete(replacedId);
    }
    this.clearWeldsAtIndex(index);

    const id = this.nextTileId;
    this.nextTileId += 1;
    this.replaceKindAtIndex(index, kind);
    this.cells.ids[index] = id;
    this.cells.orientations[index] = orientation;
    this.cells.resetTransientState(index);
    const componentState = createDefaultComponentState(
      kind,
      orientation,
      (width, height) => new World(width, height),
    );
    if (componentState !== null) {
      this.componentStates.set(id, componentState);
    }
    this.touchGeometryRevision();
    return id;
  }

  clear(): void {
    this.cells.clear();
    this.featureIndex.clear();
    this.componentStates.clear();
    this.textBoxesValue = Object.freeze([]);
    this.puzzleResultValue = PuzzleResult.InProgress;
    this.touchGeometryRevision();
  }

  clone(): World {
    const copy = new World(this.width, this.height);
    copy.copyFrom(this);
    return copy;
  }

  copyFrom(source: World): void {
    if (source.width !== this.width || source.height !== this.height) {
      throw new RangeError("Cannot copy worlds with different dimensions");
    }

    this.cells.copyFrom(source.cells);
    this.featureIndex.copyFrom(source.featureIndex);
    const previousStates = new Map(this.componentStates);
    this.componentStates.clear();
    for (const [id, state] of source.componentStates) {
      const existing = previousStates.get(id);
      if (
        state.type === "array" &&
        existing?.type === "array" &&
        existing.world.width === state.world.width &&
        existing.world.height === state.world.height &&
        existing.world !== state.world
      ) {
        existing.world.copyFrom(state.world);
        existing.ports.set(state.ports);
        existing.description = state.description;
        this.componentStates.set(id, existing);
      } else {
        this.componentStates.set(id, cloneComponentState(state));
      }
    }
    // Frozen snapshots can be shared safely, including the per-tick render-state copy.
    this.textBoxesValue = source.textBoxesValue;
    this.puzzleResultValue = source.puzzleResultValue;
    this.nextTileId = source.nextTileId;
    this.touchGeometryRevision();
  }

  kindAtIndex(index: number): TileKind {
    this.assertIndex(index);
    return this.cells.kinds[index] as TileKind;
  }
  orientationAtIndex(index: number): Direction {
    this.assertIndex(index);
    return this.cells.orientations[index] as Direction;
  }

  chargeAtPort(x: number, y: number, direction: Direction): Charge {
    return this.chargeAtPortIndex(this.indexOf(x, y), direction);
  }

  /** Charge exposed to neighbors; isolated inputs never expose the tile's output. */
  chargeAtPortIndex(index: number, direction: Direction): Charge {
    this.assertIndex(index);
    if (
      !Number.isInteger(direction) ||
      direction < Direction.Up ||
      direction > Direction.Left
    ) {
      throw new RangeError(`Invalid circuit direction ${direction as number}`);
    }
    const kind = this.cells.kinds[index] as TileKind;
    if (kind === TileKind.RuneArray) {
      return this.requireRuneArrayStateAtIndex(index).ports[direction] as Charge;
    }
    if (kind === TileKind.MovementSensor) {
      return this.movementSensorStateAtIndex(index).ports[direction];
    }
    const definition = TILE_DEFINITIONS[kind];
    const inputSides = orientedSides(
      definition.circuitInputPorts,
      this.cells.orientations[index] as Direction,
    );
    if ((inputSides & (1 << direction)) !== 0) {
      return 0;
    }
    const outputSides = orientedSides(
      definition.circuitOutputPorts,
      this.cells.orientations[index] as Direction,
    );
    if (
      hasSeparateIsolatedOutput(kind) &&
      (outputSides & (1 << direction)) !== 0
    ) {
      return this.cells.isolatedOutputCharges[index] as Charge;
    }
    return kind === TileKind.WireCrossing &&
        (direction === Direction.Up || direction === Direction.Down)
      ? this.cells.crossingVerticalCharges[index] as Charge
      : this.cells.charges[index] as Charge;
  }

  sensorOutputAtIndex(index: number): Charge {
    this.assertIndex(index);
    if (this.cells.kinds[index] !== TileKind.Sensor) {
      throw new Error(`Tile at index ${index} is not a sensor`);
    }

    const x = index % this.width;
    const y = (index - x) / this.width;
    const orientation = this.cells.orientations[index] as Direction;
    const sensedX = x + directionX(orientation);
    const sensedY = y + directionY(orientation);
    if (
      sensedX < 0 || sensedX >= this.width ||
      sensedY < 0 || sensedY >= this.height
    ) {
      return 0;
    }
    const sensedKind = this.cells.kinds[sensedY * this.width + sensedX] as TileKind;
    return sensedKind !== TileKind.Empty && !TILE_DEFINITIONS[sensedKind].invisibleToSensor
      ? 1
      : 0;
  }

  hasRightWeldAtIndex(index: number): boolean {
    this.assertIndex(index);
    return index % this.width < this.width - 1 && this.cells.rightWelds[index] === 1;
  }

  hasDownWeldAtIndex(index: number): boolean {
    this.assertIndex(index);
    return index < this.cellCount - this.width && this.cells.downWelds[index] === 1;
  }
  hasWeldAtIndex(index: number, direction: Direction): boolean {
    this.assertIndex(index);
    const x = index % this.width;
    switch (direction) {
      case Direction.Up:
        return index >= this.width && this.cells.downWelds[index - this.width] === 1;
      case Direction.Right:
        return x < this.width - 1 && this.cells.rightWelds[index] === 1;
      case Direction.Down:
        return index < this.cellCount - this.width && this.cells.downWelds[index] === 1;
      case Direction.Left:
        return x > 0 && this.cells.rightWelds[index - 1] === 1;
      default:
        throw new RangeError(`Invalid weld direction ${direction as number}`);
    }
  }

  applyPistonTransitions(
    actions: Int8Array,
    headWelds: Uint8Array,
    armIds: Uint32Array,
  ): number {
    if (
      actions.length !== this.cellCount ||
      headWelds.length !== this.cellCount ||
      armIds.length !== this.cellCount
    ) {
      throw new RangeError("Piston transition buffers must match the world cell count");
    }

    let transitionCount = 0;
    for (
      let base = this.firstFeatureIndex(WorldFeature.Piston);
      base >= 0;
      base = this.nextFeatureIndex(WorldFeature.Piston, base)
    ) {
      const action = expectDefined(actions[base], "piston action");
      if (action === 0) {
        continue;
      }
      const orientation = this.cells.orientations[base] as Direction;
      const arm = this.neighborIndex(base, orientation);
      if (arm < 0) {
        throw new Error(`Piston transition at index ${base} leaves the world`);
      }
      const head = this.neighborIndex(arm, orientation);
      const headWelded = expectDefined(headWelds[base], "piston head weld") === 1;

      if (action === 1) {
        if (this.cells.kinds[base] !== TileKind.Piston || this.cells.kinds[arm] !== TileKind.Empty) {
          throw new Error(`Invalid piston extension at index ${base}`);
        }
        const movingArmId = expectDefined(this.cells.ids[base], "retracted piston ID");
        this.replaceKindAtIndex(base, TileKind.PistonBase);
        this.cells.ids[base] = this.nextTileId;
        this.nextTileId += 1;
        this.replaceKindAtIndex(arm, TileKind.PistonArm);
        this.cells.ids[arm] = movingArmId;
        this.cells.orientations[arm] = orientation;
        this.cells.resetTransientState(arm);
        this.setWeldAtIndices(base, arm, 1);
        if (head >= 0) {
          this.setWeldAtIndices(arm, head, headWelded ? 1 : 0);
        }
        this.clearDisallowedWeldsAtIndex(arm);
      } else if (action === -1) {
        if (this.cells.kinds[base] !== TileKind.PistonBase) {
          throw new Error(`Invalid piston retraction at index ${base}`);
        }
        const movingArmId = expectDefined(armIds[base], "extended piston arm ID");
        if (movingArmId === 0) {
          throw new Error(`Piston retraction at index ${base} has no arm ID`);
        }
        this.replaceKindAtIndex(base, TileKind.Piston);
        this.cells.ids[base] = movingArmId;
        if (headWelded) {
          if (this.cells.kinds[arm] === TileKind.Empty) {
            throw new Error(`Retracting piston at index ${base} lost its welded target`);
          }
          this.setWeldAtIndices(base, arm, 1);
        } else {
          this.clearIndex(arm);
        }
        this.clearDisallowedWeldsAtIndex(base);
      } else {
        throw new RangeError(`Invalid piston action ${action}`);
      }
      transitionCount += 1;
    }
    if (transitionCount > 0) {
      this.touchGeometryRevision();
    }
    return transitionCount;
  }


  moveBodies(
    bodyRoots: Int32Array,
    horizontalMoves: Int8Array | Int16Array,
    verticalMoves: Int8Array | Int16Array,
  ): number {
    if (
      bodyRoots.length !== this.cellCount ||
      horizontalMoves.length !== this.cellCount ||
      verticalMoves.length !== this.cellCount
    ) {
      throw new RangeError("Movement buffers must match the world cell count");
    }

    let movementCount = 0;
    for (
      let source = this.firstFeatureIndex(WorldFeature.Occupied);
      source >= 0;
      source = this.nextFeatureIndex(WorldFeature.Occupied, source)
    ) {
      const root = expectDefined(bodyRoots[source], "moving body root");
      const moveX = expectDefined(horizontalMoves[root], "horizontal body movement");
      const moveY = expectDefined(verticalMoves[root], "vertical body movement");
      if (moveX === 0 && moveY === 0) {
        continue;
      }
      const sourceX = source % this.width;
      const sourceY = (source - sourceX) / this.width;
      const destinationX = sourceX + moveX;
      const destinationY = sourceY + moveY;
      if (
        destinationX < 0 ||
        destinationX >= this.width ||
        destinationY < 0 ||
        destinationY >= this.height
      ) {
        throw new Error(`Body movement from index ${source} leaves the world`);
      }
      movementCount += 1;
    }
    if (movementCount === 0) {
      return 0;
    }

    const moved = this.movedCells;
    moved.copyFrom(this.cells);
    for (
      let source = this.firstFeatureIndex(WorldFeature.Occupied);
      source >= 0;
      source = this.nextFeatureIndex(WorldFeature.Occupied, source)
    ) {
      const root = expectDefined(bodyRoots[source], "moving body root");
      if (horizontalMoves[root] !== 0 || verticalMoves[root] !== 0) {
        moved.clearCell(source);
      }
    }
    for (
      let source = this.firstFeatureIndex(WorldFeature.Occupied);
      source >= 0;
      source = this.nextFeatureIndex(WorldFeature.Occupied, source)
    ) {
      const root = expectDefined(bodyRoots[source], "moving body root");
      const moveX = expectDefined(horizontalMoves[root], "horizontal body movement");
      const moveY = expectDefined(verticalMoves[root], "vertical body movement");
      if (moveX === 0 && moveY === 0) {
        continue;
      }
      moved.copyCell(this.cells, source, source + moveX + moveY * this.width);
    }
    this.cells.copyFrom(moved);
    this.featureIndex.rebuild(this.cells.kinds);
    this.touchGeometryRevision();
    return movementCount;
  }

  /**
   * Atomically rotates the selected occupied cells around a stationary pivot cell.
   * `quarterTurn` is +1 clockwise or -1 counterclockwise in screen coordinates.
   */
  rotateCells(
    selected: Uint8Array,
    pivot: number,
    quarterTurn: -1 | 1,
  ): number {
    if (selected.length !== this.cellCount) {
      throw new RangeError("Rotation selection must match the world cell count");
    }
    this.assertIndex(pivot);
    const pivotX = pivot % this.width;
    const pivotY = (pivot - pivotX) / this.width;
    const destinationFor = (source: number): number => {
      const sourceX = source % this.width;
      const sourceY = (source - sourceX) / this.width;
      const deltaX = sourceX - pivotX;
      const deltaY = sourceY - pivotY;
      const destinationX = pivotX + (quarterTurn === 1 ? -deltaY : deltaY);
      const destinationY = pivotY + (quarterTurn === 1 ? deltaX : -deltaX);
      return destinationX < 0 ||
          destinationX >= this.width ||
          destinationY < 0 ||
          destinationY >= this.height
        ? -1
        : destinationY * this.width + destinationX;
    };

    let rotatedCellCount = 0;
    for (let source = 0; source < this.cellCount; source += 1) {
      if (selected[source] === 0) {
        continue;
      }
      if (selected[source] !== 1 || this.cells.kinds[source] === TileKind.Empty) {
        throw new Error(`Rotation selection contains invalid cell ${source}`);
      }
      const destination = destinationFor(source);
      if (destination < 0) {
        throw new Error(`Rotation from index ${source} leaves the world`);
      }
      if (this.cells.kinds[destination] !== TileKind.Empty && selected[destination] === 0) {
        throw new Error(`Rotation from index ${source} collides at index ${destination}`);
      }
      const x = source % this.width;
      if (
        this.cells.rightWelds[source] === 1 &&
        (x >= this.width - 1 || selected[source + 1] === 0)
      ) {
        throw new Error(`Rotation selection splits a right weld at index ${source}`);
      }
      if (
        this.cells.downWelds[source] === 1 &&
        (source >= this.cellCount - this.width || selected[source + this.width] === 0)
      ) {
        throw new Error(`Rotation selection splits a down weld at index ${source}`);
      }
      if (x > 0 && this.cells.rightWelds[source - 1] === 1 && selected[source - 1] === 0) {
        throw new Error(`Rotation selection splits a left weld at index ${source}`);
      }
      if (
        source >= this.width &&
        this.cells.downWelds[source - this.width] === 1 &&
        selected[source - this.width] === 0
      ) {
        throw new Error(`Rotation selection splits an up weld at index ${source}`);
      }
      rotatedCellCount += 1;
    }
    if (rotatedCellCount === 0) {
      return 0;
    }

    const moved = this.movedCells;
    moved.copyFrom(this.cells);
    for (let source = 0; source < this.cellCount; source += 1) {
      if (selected[source] !== 0) {
        moved.clearCell(source);
      }
    }

    const turns = quarterTurn === 1 ? 1 : 3;
    for (let source = 0; source < this.cellCount; source += 1) {
      if (selected[source] === 0) {
        continue;
      }
      const destination = destinationFor(source);
      const kind = this.cells.kinds[source] as TileKind;
      const id = expectDefined(this.cells.ids[source], "rotating tile ID");
      moved.copyCell(this.cells, source, destination);
      moved.orientations[destination] = orientationForKind(
        kind,
        (((this.cells.orientations[source] as Direction) + quarterTurn + 4) & 3) as Direction,
      );
      if (kind === TileKind.WireCrossing) {
        moved.charges[destination] = expectDefined(
          this.cells.crossingVerticalCharges[source],
          "rotating vertical crossing charge",
        );
        moved.crossingVerticalCharges[destination] = expectDefined(
          this.cells.charges[source],
          "rotating horizontal crossing charge",
        );
      } else {
        moved.crossingVerticalCharges[destination] = 0;
      }
      // Welds turn with the selection and are re-derived below.
      moved.rightWelds[destination] = 0;
      moved.downWelds[destination] = 0;
      if (hasComponentState(kind)) {
        const snapshot = snapshotComponentState(this.requireComponentStateAtIndex(source));
        this.componentStates.set(
          id,
          stateFromSnapshot(transformComponentSnapshot(snapshot, turns, false, false)),
        );
      }
    }

    const setRotatedWeld = (first: number, second: number): void => {
      if (second === first + 1) {
        moved.rightWelds[first] = 1;
      } else if (first === second + 1) {
        moved.rightWelds[second] = 1;
      } else if (second === first + this.width) {
        moved.downWelds[first] = 1;
      } else if (first === second + this.width) {
        moved.downWelds[second] = 1;
      } else {
        throw new Error(`Rotated weld endpoints ${first} and ${second} are not adjacent`);
      }
    };
    for (let source = 0; source < this.cellCount; source += 1) {
      if (selected[source] === 0) {
        continue;
      }
      const destination = destinationFor(source);
      if (this.cells.rightWelds[source] === 1) {
        setRotatedWeld(destination, destinationFor(source + 1));
      }
      if (this.cells.downWelds[source] === 1) {
        setRotatedWeld(destination, destinationFor(source + this.width));
      }
    }

    this.cells.copyFrom(moved);
    this.featureIndex.rebuild(this.cells.kinds);
    this.touchGeometryRevision();
    return rotatedCellCount;
  }



  /**
   * Builds a new world holding this board flipped, then rotated clockwise by
   * `quarterTurns`, with tile orientations, nested rune arrays, circuit charges, and welds
   * mapped along. Furnace progress is dropped and tiles receive fresh identities.
   * Annotation rectangles follow the board transform, with their text remaining upright.
   */
  transformed(
    quarterTurns: number,
    flippedHorizontally: boolean,
    flippedVertically: boolean,
  ): World {
    const turns = ((quarterTurns % 4) + 4) % 4;
    const swapAxes = (turns & 1) === 1;
    const result = new World(
      swapAxes ? this.height : this.width,
      swapAxes ? this.width : this.height,
    );
    result.setTextBoxes(this.textBoxesValue.map((box) => {
      let x = flippedHorizontally ? this.width - (box.x + box.width) : box.x;
      let y = flippedVertically ? this.height - (box.y + box.height) : box.y;
      let width = box.width;
      let height = box.height;
      for (let turn = 0; turn < turns; turn += 1) {
        const boardHeight = (turn & 1) === 0 ? this.height : this.width;
        const rotatedX = Math.max(0, boardHeight - (y + height));
        y = x;
        x = rotatedX;
        [width, height] = [height, width];
      }
      // Clamp rounding at the boundary without rotating or mirroring the text itself.
      return {
        ...box, x, y,
        width: Math.min(width, result.width - x),
        height: Math.min(height, result.height - y),
      };
    }));
    const mapCell = (x: number, y: number): { x: number; y: number } => {
      let sourceX = flippedHorizontally ? this.width - 1 - x : x;
      let sourceY = flippedVertically ? this.height - 1 - y : y;
      for (let turn = 0; turn < turns; turn += 1) {
        const rotatedHeight = (turn & 1) === 0 ? this.height : this.width;
        const rotatedX = rotatedHeight - 1 - sourceY;
        sourceY = sourceX;
        sourceX = rotatedX;
      }
      return { x: sourceX, y: sourceY };
    };
    const mapDirection = (direction: Direction): Direction => {
      let mapped = direction;
      if (flippedHorizontally) {
        mapped = flipDirectionHorizontally(mapped);
      }
      if (flippedVertically) {
        mapped = flipDirectionVertically(mapped);
      }
      return ((mapped + turns) & 3) as Direction;
    };

    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const index = y * this.width + x;
        const kind = this.cells.kinds[index] as TileKind;
        if (kind === TileKind.Empty) {
          continue;
        }
        const destination = mapCell(x, y);
        const orientation = orientationForKind(
          kind,
          mapDirection(this.cells.orientations[index] as Direction),
        );
        result.place(destination.x, destination.y, kind, orientation);
        const snapshot = this.componentStateSnapshotAtIndex(index);
        if (snapshot !== null) {
          result.restoreComponentState(
            destination.x,
            destination.y,
            transformComponentSnapshot(snapshot, turns, flippedHorizontally, flippedVertically),
          );
        }
        if (kind === TileKind.WireCrossing) {
          const horizontal = this.cells.charges[index] as Charge;
          const vertical = this.cells.crossingVerticalCharges[index] as Charge;
          if (swapAxes) {
            result.setCrossingCharges(destination.x, destination.y, vertical, horizontal);
          } else {
            result.setCrossingCharges(destination.x, destination.y, horizontal, vertical);
          }
        } else if (kind !== TileKind.RuneArray && kind !== TileKind.MovementSensor &&
            this.cells.charges[index] !== 0) {
          result.setCharge(destination.x, destination.y, this.cells.charges[index] as Charge);
        }
        if (this.cells.isolatedOutputCharges[index] !== 0) {
          result.setIsolatedOutputCharge(
            destination.x,
            destination.y,
            this.cells.isolatedOutputCharges[index] as Charge,
          );
        }
      }
    }
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const index = y * this.width + x;
        const source = mapCell(x, y);
        if (x < this.width - 1 && this.cells.rightWelds[index] === 1) {
          const neighbor = mapCell(x + 1, y);
          result.setWeld(source.x, source.y, neighbor.x, neighbor.y, true);
        }
        if (y < this.height - 1 && this.cells.downWelds[index] === 1) {
          const neighbor = mapCell(x, y + 1);
          result.setWeld(source.x, source.y, neighbor.x, neighbor.y, true);
        }
      }
    }
    result.puzzleResultValue = this.puzzleResultValue;
    return result;
  }

  /**
   * Copies every tile, component state, charge, and weld of `source` into this world with
   * both centers aligned, dropping whatever falls outside. Both dimensions must share the
   * source's parity so the centers coincide on whole cells.
   * Annotations move by the same offset and are clipped to the destination board.
   */
  copyCenteredFrom(source: World): void {
    const offsetX = (this.width - source.width) / 2;
    const offsetY = (this.height - source.height) / 2;
    if (!Number.isInteger(offsetX) || !Number.isInteger(offsetY)) {
      throw new RangeError("Centered copies require dimensions of matching parity");
    }
    // Keep the visible part of each annotation when resizing around the board center.
    const boxes: TextBox[] = [];
    for (const box of source.textBoxesValue) {
      const x = Math.max(0, box.x + offsetX);
      const y = Math.max(0, box.y + offsetY);
      const right = Math.min(this.width, box.x + box.width + offsetX);
      const bottom = Math.min(this.height, box.y + box.height + offsetY);
      if (right > x && bottom > y) {
        boxes.push({ ...box, x, y, width: right - x, height: bottom - y });
      }
    }
    this.setTextBoxes(boxes);
    const inside = (x: number, y: number): boolean =>
      x >= 0 && x < this.width && y >= 0 && y < this.height;
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const targetX = x + offsetX;
        const targetY = y + offsetY;
        if (!inside(targetX, targetY)) {
          continue;
        }
        const index = y * source.width + x;
        const kind = source.cells.kinds[index] as TileKind;
        if (kind === TileKind.Empty) {
          continue;
        }
        this.place(targetX, targetY, kind, source.cells.orientations[index] as Direction);
        const snapshot = source.componentStateSnapshotAtIndex(index);
        if (snapshot !== null) {
          this.restoreComponentState(targetX, targetY, snapshot);
        }
        if (kind === TileKind.WireCrossing) {
          this.setCrossingCharges(
            targetX,
            targetY,
            source.cells.charges[index] as Charge,
            source.cells.crossingVerticalCharges[index] as Charge,
          );
        } else if (kind !== TileKind.RuneArray && kind !== TileKind.MovementSensor &&
            source.cells.charges[index] !== 0) {
          this.setCharge(targetX, targetY, source.cells.charges[index] as Charge);
        }
        if (source.cells.isolatedOutputCharges[index] !== 0) {
          this.setIsolatedOutputCharge(
            targetX,
            targetY,
            source.cells.isolatedOutputCharges[index] as Charge,
          );
        }
      }
    }
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const index = y * source.width + x;
        const targetX = x + offsetX;
        const targetY = y + offsetY;
        if (
          x < source.width - 1 &&
          source.cells.rightWelds[index] === 1 &&
          inside(targetX, targetY) &&
          inside(targetX + 1, targetY)
        ) {
          this.setWeld(targetX, targetY, targetX + 1, targetY, true);
        }
        if (
          y < source.height - 1 &&
          source.cells.downWelds[index] === 1 &&
          inside(targetX, targetY) &&
          inside(targetX, targetY + 1)
        ) {
          this.setWeld(targetX, targetY, targetX, targetY + 1, true);
        }
      }
    }
  }

  private indexOf(x: number, y: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new RangeError(`Cell (${x}, ${y}) is outside the world`);
    }
    return y * this.width + x;
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.cellCount) {
      throw new RangeError(`Cell index ${index} is outside the world`);
    }
  }

  private neighborIndex(index: number, direction: Direction): number {
    const x = index % this.width;
    if (
      (direction === Direction.Up && index < this.width) ||
      (direction === Direction.Right && x >= this.width - 1) ||
      (direction === Direction.Down && index >= this.cellCount - this.width) ||
      (direction === Direction.Left && x === 0)
    ) {
      return -1;
    }
    return index + directionX(direction) + directionY(direction) * this.width;
  }

  private directionalNeighborIndex(index: number): number {
    const direction = this.cells.orientations[index] as Direction;
    const x = index % this.width;
    if (
      (direction === Direction.Up && index < this.width) ||
      (direction === Direction.Right && x >= this.width - 1) ||
      (direction === Direction.Down && index >= this.cellCount - this.width) ||
      (direction === Direction.Left && x === 0)
    ) {
      return -1;
    }
    return index + directionX(direction) + directionY(direction) * this.width;
  }

  private areWeldedAtIndices(first: number, second: number): boolean {
    const difference = second - first;
    if (difference === 1 && first % this.width < this.width - 1) {
      return this.cells.rightWelds[first] === 1;
    }
    if (difference === -1 && second % this.width < this.width - 1) {
      return this.cells.rightWelds[second] === 1;
    }
    if (difference === this.width) {
      return this.cells.downWelds[first] === 1;
    }
    if (difference === -this.width) {
      return this.cells.downWelds[second] === 1;
    }
    throw new RangeError("A weld requires two orthogonally adjacent cells");
  }

  private setWeldAtIndices(first: number, second: number, value: 0 | 1): void {
    const difference = second - first;
    if (difference === 1 && first % this.width < this.width - 1) {
      this.cells.rightWelds[first] = value;
    } else if (difference === -1 && second % this.width < this.width - 1) {
      this.cells.rightWelds[second] = value;
    } else if (difference === this.width) {
      this.cells.downWelds[first] = value;
    } else if (difference === -this.width) {
      this.cells.downWelds[second] = value;
    } else {
      throw new RangeError("A weld requires two orthogonally adjacent cells");
    }
  }

  private weldStorage(first: number, second: number): { readonly welds: Uint8Array; readonly index: number } {
    const difference = second - first;
    if (difference === 1 && first % this.width < this.width - 1) {
      return { welds: this.cells.rightWelds, index: first };
    }
    if (difference === -1 && second % this.width < this.width - 1) {
      return { welds: this.cells.rightWelds, index: second };
    }
    if (difference === this.width) {
      return { welds: this.cells.downWelds, index: first };
    }
    if (difference === -this.width) {
      return { welds: this.cells.downWelds, index: second };
    }
    throw new RangeError("A weld requires two orthogonally adjacent cells");
  }

  private canWeldIndices(first: number, second: number): boolean {
    const difference = second - first;
    let firstSide: Direction;
    if (difference === 1 && first % this.width < this.width - 1) {
      firstSide = Direction.Right;
    } else if (difference === -1 && second % this.width < this.width - 1) {
      firstSide = Direction.Left;
    } else if (difference === this.width) {
      firstSide = Direction.Down;
    } else if (difference === -this.width) {
      firstSide = Direction.Up;
    } else {
      throw new RangeError("A weld requires two orthogonally adjacent cells");
    }

    const firstDefinition = TILE_DEFINITIONS[this.cells.kinds[first] as TileKind];
    const secondDefinition = TILE_DEFINITIONS[this.cells.kinds[second] as TileKind];
    const secondSide = oppositeDirection(firstSide);
    const firstWeldableSides = orientedSides(
      firstDefinition.weldableSides,
      this.cells.orientations[first] as Direction,
    );
    const secondWeldableSides = orientedSides(
      secondDefinition.weldableSides,
      this.cells.orientations[second] as Direction,
    );
    return (
      (firstWeldableSides & (1 << firstSide)) !== 0 &&
      (secondWeldableSides & (1 << secondSide)) !== 0 &&
      (!firstDefinition.excludesFacingWeld || this.cells.orientations[first] !== firstSide) &&
      (!secondDefinition.excludesFacingWeld || this.cells.orientations[second] !== secondSide)
    );
  }

  private clearDisallowedWeldsAtIndex(index: number): void {
    if (
      index % this.width < this.width - 1 &&
      this.cells.rightWelds[index] === 1 &&
      !this.canWeldIndices(index, index + 1)
    ) {
      this.cells.rightWelds[index] = 0;
    }
    if (
      index % this.width > 0 &&
      this.cells.rightWelds[index - 1] === 1 &&
      !this.canWeldIndices(index - 1, index)
    ) {
      this.cells.rightWelds[index - 1] = 0;
    }
    if (
      index < this.cellCount - this.width &&
      this.cells.downWelds[index] === 1 &&
      !this.canWeldIndices(index, index + this.width)
    ) {
      this.cells.downWelds[index] = 0;
    }
    if (
      index >= this.width &&
      this.cells.downWelds[index - this.width] === 1 &&
      !this.canWeldIndices(index - this.width, index)
    ) {
      this.cells.downWelds[index - this.width] = 0;
    }
  }

  private clearWeldsAtIndex(index: number): void {
    this.cells.rightWelds[index] = 0;
    this.cells.downWelds[index] = 0;
    if (index % this.width > 0) {
      this.cells.rightWelds[index - 1] = 0;
    }
    if (index >= this.width) {
      this.cells.downWelds[index - this.width] = 0;
    }
  }

  private requireComponentStateAtIndex(index: number): ConfigurableComponentState {
    this.assertIndex(index);
    const id = this.cells.ids[index] ?? 0;
    if (id === 0) {
      throw new Error(`Configurable component at index ${index} has no tile identity`);
    }
    const state = this.componentStates.get(id);
    if (state === undefined) {
      throw new Error(`Configurable component at index ${index} has no state`);
    }
    const kind = this.cells.kinds[index] as TileKind;
    if (!componentStateMatchesKind(state, kind)) {
      throw new Error(`Component state at index ${index} does not match ${TILE_DEFINITIONS[kind].name}`);
    }
    return state;
  }

  private requireAssemblerStateAtIndex(index: number): AssemblerComponentState {
    if (this.cells.kinds[index] !== TileKind.Assembler) {
      throw new Error(`Tile at index ${index} is not an assembler`);
    }
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "assembler") {
      throw new Error(`Assembler at index ${index} has mismatched component state`);
    }
    return state;
  }

  private requireRuneArrayStateAtIndex(index: number): RuneArrayComponentState {
    if (this.cells.kinds[index] !== TileKind.RuneArray) {
      throw new Error(`Tile at index ${index} is not a rune array`);
    }
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "array") {
      throw new Error(`Rune array at index ${index} has mismatched component state`);
    }
    return state;
  }

  private clearIndex(index: number): void {
    const id = this.cells.ids[index] ?? 0;
    if (id !== 0) {
      this.componentStates.delete(id);
    }
    this.replaceKindAtIndex(index, TileKind.Empty);
    this.cells.clearCell(index);
    this.clearWeldsAtIndex(index);
  }

  private replaceKindAtIndex(index: number, kind: TileKind): void {
    const previousKind = this.cells.kinds[index] as TileKind;
    if (previousKind === kind) {
      return;
    }
    this.featureIndex.replace(index, previousKind, kind);
    this.cells.kinds[index] = kind;
  }
}

function hasSeparateIsolatedOutput(kind: TileKind): boolean {
  const definition = TILE_DEFINITIONS[kind];
  const sharedPorts = definition.circuitPorts &
    ~(definition.circuitInputPorts | definition.circuitOutputPorts);
  return sharedPorts !== 0 && definition.circuitOutputPorts !== 0;
}
