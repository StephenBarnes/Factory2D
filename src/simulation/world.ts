import {
  cloneComponentState,
  componentConfigurationForKind,
  componentStateMatchesKind,
  createDefaultComponentState,
  MAX_ROM_DIMENSION,
  MIN_ROM_DIMENSION,
  snapshotComponentState,
  stateFromSnapshot,
  validateComponentSnapshot,
  validateSignalLabel,
  type ConfigurableComponentSnapshot,
  type ConfigurableComponentState,
} from "./configurable-components";
import { isCharge, type Charge } from "./circuit";
import { furnaceRecipeFor } from "./furnace";
import { PuzzleResult } from "./puzzle-result";
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

export interface Tile {
  readonly kind: TileKind;
  readonly id: number;
}

export class World {
  readonly width: number;
  readonly height: number;
  readonly cellCount: number;

  private readonly kinds: Uint8Array;
  private readonly ids: Uint32Array;
  private readonly orientations: Uint8Array;
  private readonly charges: Int8Array;
  private readonly crossingVerticalCharges: Int8Array;
  private readonly isolatedOutputCharges: Int8Array;
  private readonly furnaceProgress: Uint16Array;
  private readonly furnaceTargetIds: Uint32Array;
  private readonly componentStates = new Map<number, ConfigurableComponentState>();
  private nextTileId = 1;
  private readonly rightWelds: Uint8Array;
  private readonly downWelds: Uint8Array;
  private readonly movedKinds: Uint8Array;
  private readonly movedIds: Uint32Array;
  private readonly movedOrientations: Uint8Array;
  private readonly movedCharges: Int8Array;
  private readonly movedCrossingVerticalCharges: Int8Array;
  private readonly movedIsolatedOutputCharges: Int8Array;
  private readonly movedFurnaceProgress: Uint16Array;
  private readonly movedFurnaceTargetIds: Uint32Array;
  private readonly movedRightWelds: Uint8Array;
  private readonly movedDownWelds: Uint8Array;
  private revisionValue = 0;
  private puzzleResultValue = PuzzleResult.InProgress;

  constructor(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("World dimensions must be positive integers");
    }

    this.width = width;
    this.height = height;
    this.cellCount = width * height;
    this.kinds = new Uint8Array(this.cellCount);
    this.ids = new Uint32Array(this.cellCount);
    this.orientations = new Uint8Array(this.cellCount);
    this.charges = new Int8Array(this.cellCount);
    this.crossingVerticalCharges = new Int8Array(this.cellCount);
    this.isolatedOutputCharges = new Int8Array(this.cellCount);
    this.furnaceProgress = new Uint16Array(this.cellCount);
    this.furnaceTargetIds = new Uint32Array(this.cellCount);
    this.rightWelds = new Uint8Array(this.cellCount);
    this.downWelds = new Uint8Array(this.cellCount);
    this.movedKinds = new Uint8Array(this.cellCount);
    this.movedIds = new Uint32Array(this.cellCount);
    this.movedOrientations = new Uint8Array(this.cellCount);
    this.movedCharges = new Int8Array(this.cellCount);
    this.movedCrossingVerticalCharges = new Int8Array(this.cellCount);
    this.movedIsolatedOutputCharges = new Int8Array(this.cellCount);
    this.movedFurnaceProgress = new Uint16Array(this.cellCount);
    this.movedFurnaceTargetIds = new Uint32Array(this.cellCount);
    this.movedRightWelds = new Uint8Array(this.cellCount);
    this.movedDownWelds = new Uint8Array(this.cellCount);
  }

  /** Monotonically increases whenever this world's renderable state may have changed. */
  get revision(): number {
    return this.revisionValue;
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
    return this.kinds[this.indexOf(x, y)] as TileKind;
  }

  idAtIndex(index: number): number {
    this.assertIndex(index);
    return this.ids[index] ?? 0;
  }

  idAt(x: number, y: number): number {
    return this.ids[this.indexOf(x, y)] ?? 0;
  }
  orientationAt(x: number, y: number): Direction {
    return this.orientations[this.indexOf(x, y)] as Direction;
  }

  chargeAt(x: number, y: number): Charge {
    const index = this.indexOf(x, y);
    if (this.kinds[index] === TileKind.WireCrossing) {
      throw new Error("Wire crossing charges must be read from a circuit port");
    }
    return this.charges[index] as Charge;
  }

  tileAt(x: number, y: number): Tile {
    const index = this.indexOf(x, y);
    return {
      kind: this.kinds[index] as TileKind,
      id: this.ids[index] ?? 0,
    };
  }

  setCharge(x: number, y: number, charge: Charge): void {
    const index = this.indexOf(x, y);
    if (!isCharge(charge)) {
      throw new RangeError(`Invalid circuit charge ${charge as number}`);
    }
    const kind = this.kinds[index] as TileKind;
    if (charge !== 0 && TILE_DEFINITIONS[kind].circuitPorts === 0) {
      throw new Error("Only circuit-connected tiles can hold a nonzero charge");
    }
    if (kind === TileKind.WireCrossing && charge !== 0) {
      throw new Error("Wire crossing charges must specify a circuit axis");
    }
    if (
      this.charges[index] !== charge ||
      (kind === TileKind.WireCrossing && this.crossingVerticalCharges[index] !== 0)
    ) {
      this.charges[index] = charge;
      this.crossingVerticalCharges[index] = 0;
      this.revisionValue += 1;
    }
  }

  setCrossingCharges(x: number, y: number, horizontal: Charge, vertical: Charge): void {
    const index = this.indexOf(x, y);
    if (this.kinds[index] !== TileKind.WireCrossing) {
      throw new Error(`Tile at (${x}, ${y}) is not a wire crossing`);
    }
    if (!isCharge(horizontal) || !isCharge(vertical)) {
      throw new RangeError("Invalid wire crossing charge");
    }
    if (
      this.charges[index] !== horizontal ||
      this.crossingVerticalCharges[index] !== vertical
    ) {
      this.charges[index] = horizontal;
      this.crossingVerticalCharges[index] = vertical;
      this.revisionValue += 1;
    }
  }
  setIsolatedOutputCharge(x: number, y: number, charge: Charge): void {
    const index = this.indexOf(x, y);
    const kind = this.kinds[index] as TileKind;
    if (!hasSeparateIsolatedOutput(kind)) {
      throw new Error(`Tile at (${x}, ${y}) has no separate isolated output`);
    }
    if (!isCharge(charge)) {
      throw new RangeError(`Invalid isolated output charge ${charge as number}`);
    }
    if (this.isolatedOutputCharges[index] !== charge) {
      this.isolatedOutputCharges[index] = charge;
      this.revisionValue += 1;
    }
  }


  applyCircuitCharges(
    charges: Int8Array,
    crossingVerticalCharges: Int8Array,
    isolatedOutputCharges: Int8Array,
  ): void {
    if (
      charges.length !== this.cellCount ||
      crossingVerticalCharges.length !== this.cellCount ||
      isolatedOutputCharges.length !== this.cellCount
    ) {
      throw new RangeError("Circuit charge buffers must match the world cell count");
    }

    let changed = false;
    for (let index = 0; index < this.cellCount; index += 1) {
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
      const kind = this.kinds[index] as TileKind;
      if (charge !== 0 && TILE_DEFINITIONS[kind].circuitPorts === 0) {
        throw new Error(`Non-circuit tile at index ${index} cannot hold charge`);
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
        this.charges[index] !== charge ||
        this.crossingVerticalCharges[index] !== verticalCharge ||
        this.isolatedOutputCharges[index] !== isolatedOutputCharge
      ) {
        this.charges[index] = charge;
        this.crossingVerticalCharges[index] = verticalCharge;
        this.isolatedOutputCharges[index] = isolatedOutputCharge;
        changed = true;
      }
    }
    if (changed) {
      this.revisionValue += 1;
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
    const kind = this.kinds[index] as TileKind;
    if (componentConfigurationForKind(kind) === null) {
      return null;
    }
    return snapshotComponentState(this.requireComponentStateAtIndex(index));
  }

  configureNumericComponent(x: number, y: number, value: number): boolean {
    const index = this.indexOf(x, y);
    const state = this.requireComponentStateAtIndex(index);
    const configuration = componentConfigurationForKind(this.kinds[index] as TileKind);
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
    } else if (state.type === "counter") {
      if (state.threshold === value) {
        return false;
      }
      state.threshold = value;
      state.count = 0;
    } else {
      throw new Error(`Tile at (${x}, ${y}) does not have numeric configuration`);
    }
    this.charges[index] = 0;
    this.revisionValue += 1;
    return true;
  }

  /** Replaces a ROM's or sequence checker's value grid and rewinds its progress. */
  configureTernaryGrid(
    x: number,
    y: number,
    width: number,
    height: number,
    values: readonly Charge[],
  ): boolean {
    const index = this.indexOf(x, y);
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "rom" && state.type !== "checker") {
      throw new Error(`Tile at (${x}, ${y}) does not have a ternary value grid`);
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
    let changed = state.width !== width || state.height !== height;
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
    state.cursor = 0;
    state.values = Int8Array.from(values);
    if (state.type === "checker") {
      state.failed = false;
    }
    this.charges[index] = 0;
    this.revisionValue += 1;
    return true;
  }

  configureSignalLabel(x: number, y: number, label: string): boolean {
    const index = this.indexOf(x, y);
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "monitor" && state.type !== "grapher") {
      throw new Error(`Tile at (${x}, ${y}) does not have a signal name`);
    }
    validateSignalLabel(label);
    if (state.label === label) {
      return false;
    }
    state.label = label;
    this.revisionValue += 1;
    return true;
  }

  restoreComponentState(
    x: number,
    y: number,
    snapshot: ConfigurableComponentSnapshot,
  ): void {
    const index = this.indexOf(x, y);
    const kind = this.kinds[index] as TileKind;
    validateComponentSnapshot(snapshot);
    if (!componentStateMatchesKind(snapshot, kind)) {
      throw new Error(`Component state at (${x}, ${y}) does not match ${TILE_DEFINITIONS[kind].name}`);
    }
    const id = this.ids[index] ?? 0;
    if (id === 0) {
      throw new Error(`Configurable component at (${x}, ${y}) has no tile identity`);
    }
    this.componentStates.set(id, stateFromSnapshot(snapshot));
    this.revisionValue += 1;
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
      this.revisionValue += 1;
    }
    return output;
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
    this.revisionValue += 1;
    return output;
  }

  advanceRomAtIndex(index: number, cursorDeltaX: number, cursorDeltaY: number): Charge {
    const state = this.requireComponentStateAtIndex(index);
    if (state.type !== "rom") {
      throw new Error(`Tile at index ${index} is not a ROM`);
    }
    const cellCount = state.values.length;
    let nextCursor = (state.cursor + cursorDeltaX + cellCount) % cellCount;
    if (cursorDeltaY !== 0) {
      const column = nextCursor % state.width;
      const row = (nextCursor - column) / state.width;
      const columnMajorCursor = column * state.height + row;
      const nextColumnMajorCursor =
        (columnMajorCursor + cursorDeltaY + cellCount) % cellCount;
      const nextColumn = Math.floor(nextColumnMajorCursor / state.height);
      const nextRow = nextColumnMajorCursor % state.height;
      nextCursor = nextRow * state.width + nextColumn;
    }
    if (nextCursor !== state.cursor) {
      state.cursor = nextCursor;
      this.revisionValue += 1;
    }
    return state.values[state.cursor] as Charge;
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
    if (state.cursor === 0 && input === 0) {
      return 0;
    }
    if (state.values[state.cursor] !== input) {
      state.failed = true;
      this.revisionValue += 1;
      return -1;
    }
    state.cursor += 1;
    this.revisionValue += 1;
    return state.cursor === valueCount ? 1 : 0;
  }

  furnaceProgressAt(x: number, y: number): number {
    return this.furnaceProgress[this.indexOf(x, y)] ?? 0;
  }

  furnaceProgressAtIndex(index: number): number {
    this.assertIndex(index);
    return this.furnaceProgress[index] ?? 0;
  }

  furnaceTargetIdAtIndex(index: number): number {
    this.assertIndex(index);
    return this.furnaceTargetIds[index] ?? 0;
  }

  restoreFurnaceProgress(x: number, y: number, progress: number): void {
    const index = this.indexOf(x, y);
    if (this.kinds[index] !== TileKind.Furnace) {
      throw new Error(`Tile at (${x}, ${y}) is not a furnace`);
    }
    const targetIndex = this.directionalNeighborIndex(index);
    const targetKind = targetIndex < 0
      ? TileKind.Empty
      : this.kinds[targetIndex] as TileKind;
    const recipe = furnaceRecipeFor(targetKind);
    if (recipe === undefined) {
      throw new Error(`Furnace at (${x}, ${y}) has no bakeable target`);
    }
    if (!Number.isSafeInteger(progress) || progress <= 0 || progress >= recipe.bakeTime) {
      throw new RangeError(
        `Furnace progress must be between 1 and ${recipe.bakeTime - 1} ticks`,
      );
    }
    const targetId = this.ids[targetIndex] ?? 0;
    if (targetId === 0) {
      throw new Error(`Furnace at (${x}, ${y}) has no target identity`);
    }
    this.furnaceProgress[index] = progress;
    this.furnaceTargetIds[index] = targetId;
    this.revisionValue += 1;
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
    for (let index = 0; index < this.cellCount; index += 1) {
      if (this.kinds[index] !== TileKind.Furnace) {
        continue;
      }
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
        this.furnaceProgress[index] !== progress ||
        this.furnaceTargetIds[index] !== storedTargetId
      ) {
        this.furnaceProgress[index] = progress;
        this.furnaceTargetIds[index] = storedTargetId;
        changed = true;
      }
    }

    for (let index = 0; index < this.cellCount; index += 1) {
      const targetIndex = expectDefined(
        transformTargetIndices[index],
        "furnace transform target",
      );
      if (targetIndex < 0) {
        continue;
      }
      this.assertIndex(targetIndex);
      const targetId = expectDefined(targetIds[index], "transform target ID");
      if (targetId === 0 || this.ids[targetIndex] !== targetId) {
        throw new Error(`Furnace at index ${index} lost its transform target`);
      }
      const outputKind = expectDefined(
        transformKinds[index],
        "furnace transform kind",
      ) as TileKind;
      if (outputKind === TileKind.Empty || TILE_DEFINITIONS[outputKind] === undefined) {
        throw new Error(`Furnace at index ${index} has invalid output kind ${outputKind}`);
      }
      const transformedId = this.ids[targetIndex] ?? 0;
      if (transformedId !== 0) {
        this.componentStates.delete(transformedId);
      }
      this.kinds[targetIndex] = outputKind;
      this.orientations[targetIndex] = Direction.Up;
      this.charges[targetIndex] = 0;
      this.crossingVerticalCharges[targetIndex] = 0;
      this.isolatedOutputCharges[targetIndex] = 0;
      this.furnaceProgress[targetIndex] = 0;
      this.furnaceTargetIds[targetIndex] = 0;
      this.clearDisallowedWeldsAtIndex(targetIndex);
      changed = true;
    }

    if (changed) {
      this.revisionValue += 1;
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

    for (let delivery = 0; delivery < this.cellCount; delivery += 1) {
      const target = expectDefined(targetIndices[delivery], "delivery target index");
      if (target < 0) {
        continue;
      }
      this.assertIndex(target);
      if (this.kinds[delivery] !== TileKind.Delivery) {
        throw new Error(`Non-delivery tile at index ${delivery} cannot absorb a body`);
      }
      if (
        this.kinds[target] === TileKind.Empty ||
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
        this.kinds[index] === TileKind.Empty
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
    this.revisionValue += 1;
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
        this.kinds[owner] !== TileKind.Duplicator
      ) {
        throw new Error(`Invalid duplicator owner ${owner} for destination ${destination}`);
      }
      if (this.kinds[source] === TileKind.Empty) {
        throw new Error(`Duplicator source at index ${source} is empty`);
      }
      if (this.kinds[destination] !== TileKind.Empty) {
        throw new Error(`Duplicator destination at index ${destination} is occupied`);
      }
      const sourceX = source % this.width;
      const sourceY = (source - sourceX) / this.width;
      const destinationX = destination % this.width;
      const destinationY = (destination - destinationX) / this.width;
      const ownerX = owner % this.width;
      const ownerY = (owner - ownerX) / this.width;
      const ownerOrientation = this.orientations[owner] as Direction;
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
      const kind = this.kinds[source] as TileKind;
      const sourceOrientation = this.orientations[source] as Direction;
      const ownerOrientation = this.orientations[owner] as Direction;
      const id = this.nextTileId;
      this.nextTileId += 1;
      this.kinds[destination] = kind;
      this.ids[destination] = id;
      this.orientations[destination] = orientationForKind(
        kind,
        ownerOrientation === Direction.Up || ownerOrientation === Direction.Down
          ? flipDirectionVertically(sourceOrientation)
          : flipDirectionHorizontally(sourceOrientation),
      );
      this.charges[destination] = expectDefined(
        this.charges[source],
        "duplicated tile charge",
      );
      this.crossingVerticalCharges[destination] = expectDefined(
        this.crossingVerticalCharges[source],
        "duplicated crossing charge",
      );
      this.isolatedOutputCharges[destination] = expectDefined(
        this.isolatedOutputCharges[source],
        "duplicated isolated output charge",
      );
      this.furnaceProgress[destination] = 0;
      this.furnaceTargetIds[destination] = 0;
      if (componentConfigurationForKind(kind) !== null) {
        this.componentStates.set(
          id,
          cloneComponentState(this.requireComponentStateAtIndex(source)),
        );
      }
    }

    for (let destination = 0; destination < this.cellCount; destination += 1) {
      const source = expectDefined(
        sourceForDestination[destination],
        "duplicated furnace source index",
      );
      if (source < 0 || this.kinds[source] !== TileKind.Furnace) {
        continue;
      }
      const progress = expectDefined(
        this.furnaceProgress[source],
        "duplicated furnace progress",
      );
      if (progress === 0) {
        continue;
      }
      const sourceTarget = this.neighborIndex(
        source,
        this.orientations[source] as Direction,
      );
      const destinationTarget = this.neighborIndex(
        destination,
        this.orientations[destination] as Direction,
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
        this.furnaceTargetIds[source] === this.ids[sourceTarget]
      ) {
        this.furnaceProgress[destination] = progress;
        this.furnaceTargetIds[destination] = expectDefined(
          this.ids[destinationTarget],
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
          this.rightWelds[destination] = 1;
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
          this.downWelds[destination] = 1;
        }
      }
    }
    this.revisionValue += 1;
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
    this.revisionValue += 1;
    return true;
  }
  weldEligibleNeighbors(x: number, y: number): boolean {
    const index = this.indexOf(x, y);
    let changed = false;

    if (
      x > 0 &&
      this.rightWelds[index - 1] === 0 &&
      this.canWeldIndices(index - 1, index)
    ) {
      this.rightWelds[index - 1] = 1;
      changed = true;
    }
    if (
      x < this.width - 1 &&
      this.rightWelds[index] === 0 &&
      this.canWeldIndices(index, index + 1)
    ) {
      this.rightWelds[index] = 1;
      changed = true;
    }
    if (
      y > 0 &&
      this.downWelds[index - this.width] === 0 &&
      this.canWeldIndices(index - this.width, index)
    ) {
      this.downWelds[index - this.width] = 1;
      changed = true;
    }
    if (
      y < this.height - 1 &&
      this.downWelds[index] === 0 &&
      this.canWeldIndices(index, index + this.width)
    ) {
      this.downWelds[index] = 1;
      changed = true;
    }

    if (changed) {
      this.revisionValue += 1;
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
        welded = this.downWelds[neighbor] === 1;
        break;
      case Direction.Right:
        if (x >= this.width - 1) {
          return false;
        }
        neighbor = index + 1;
        welded = this.rightWelds[index] === 1;
        break;
      case Direction.Down:
        if (index >= this.cellCount - this.width) {
          return false;
        }
        neighbor = index + this.width;
        welded = this.downWelds[index] === 1;
        break;
      case Direction.Left:
        if (x === 0) {
          return false;
        }
        neighbor = index - 1;
        welded = this.rightWelds[neighbor] === 1;
        break;
      default:
        throw new RangeError(`Invalid circuit direction ${direction as number}`);
    }
    if (!welded) {
      return false;
    }

    const ownDefinition = TILE_DEFINITIONS[this.kinds[index] as TileKind];
    const neighborDefinition = TILE_DEFINITIONS[this.kinds[neighbor] as TileKind];
    const ownPorts = orientedSides(ownDefinition.circuitPorts, this.orientations[index] as Direction);
    const neighborPorts = orientedSides(
      neighborDefinition.circuitPorts,
      this.orientations[neighbor] as Direction,
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
      if (this.kinds[index] === TileKind.Empty) {
        return 0;
      }
      this.clearIndex(index);
      this.revisionValue += 1;
      return 0;
    }

    if (this.kinds[index] === kind) {
      if (this.orientations[index] !== orientation) {
        this.orientations[index] = orientation;
        this.charges[index] = 0;
        this.crossingVerticalCharges[index] = 0;
        this.isolatedOutputCharges[index] = 0;
        this.furnaceProgress[index] = 0;
        this.furnaceTargetIds[index] = 0;
        this.clearDisallowedWeldsAtIndex(index);
        this.revisionValue += 1;
      }
      return this.ids[index] ?? 0;
    }
    const replacedId = this.ids[index] ?? 0;
    if (replacedId !== 0) {
      this.componentStates.delete(replacedId);
    }
    this.clearWeldsAtIndex(index);

    const id = this.nextTileId;
    this.nextTileId += 1;
    this.kinds[index] = kind;
    this.ids[index] = id;
    this.charges[index] = 0;
    this.crossingVerticalCharges[index] = 0;
    this.isolatedOutputCharges[index] = 0;
    this.furnaceProgress[index] = 0;
    this.furnaceTargetIds[index] = 0;
    this.orientations[index] = orientation;
    const componentState = createDefaultComponentState(kind);
    if (componentState !== null) {
      this.componentStates.set(id, componentState);
    }
    this.revisionValue += 1;
    return id;
  }

  clear(): void {
    this.kinds.fill(TileKind.Empty);
    this.ids.fill(0);
    this.orientations.fill(Direction.Up);
    this.charges.fill(0);
    this.crossingVerticalCharges.fill(0);
    this.isolatedOutputCharges.fill(0);
    this.furnaceProgress.fill(0);
    this.furnaceTargetIds.fill(0);
    this.componentStates.clear();
    this.rightWelds.fill(0);
    this.downWelds.fill(0);
    this.puzzleResultValue = PuzzleResult.InProgress;
    this.revisionValue += 1;
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

    this.kinds.set(source.kinds);
    this.ids.set(source.ids);
    this.orientations.set(source.orientations);
    this.charges.set(source.charges);
    this.crossingVerticalCharges.set(source.crossingVerticalCharges);
    this.isolatedOutputCharges.set(source.isolatedOutputCharges);
    this.furnaceProgress.set(source.furnaceProgress);
    this.furnaceTargetIds.set(source.furnaceTargetIds);
    this.rightWelds.set(source.rightWelds);
    this.downWelds.set(source.downWelds);
    this.componentStates.clear();
    for (const [id, state] of source.componentStates) {
      this.componentStates.set(id, cloneComponentState(state));
    }
    this.puzzleResultValue = source.puzzleResultValue;
    this.nextTileId = source.nextTileId;
    this.revisionValue += 1;
  }

  kindAtIndex(index: number): TileKind {
    this.assertIndex(index);
    return this.kinds[index] as TileKind;
  }
  orientationAtIndex(index: number): Direction {
    this.assertIndex(index);
    return this.orientations[index] as Direction;
  }

  chargeAtPort(x: number, y: number, direction: Direction): Charge {
    return this.chargeAtPortIndex(this.indexOf(x, y), direction);
  }

  chargeAtPortIndex(index: number, direction: Direction): Charge {
    this.assertIndex(index);
    if (
      !Number.isInteger(direction) ||
      direction < Direction.Up ||
      direction > Direction.Left
    ) {
      throw new RangeError(`Invalid circuit direction ${direction as number}`);
    }
    const kind = this.kinds[index] as TileKind;
    const definition = TILE_DEFINITIONS[kind];
    const outputSides = orientedSides(
      definition.circuitOutputPorts,
      this.orientations[index] as Direction,
    );
    if (
      hasSeparateIsolatedOutput(kind) &&
      (outputSides & (1 << direction)) !== 0
    ) {
      return this.isolatedOutputCharges[index] as Charge;
    }
    return kind === TileKind.WireCrossing &&
        (direction === Direction.Up || direction === Direction.Down)
      ? this.crossingVerticalCharges[index] as Charge
      : this.charges[index] as Charge;
  }

  sensorOutputAtIndex(index: number): Charge {
    this.assertIndex(index);
    if (this.kinds[index] !== TileKind.Sensor) {
      throw new Error(`Tile at index ${index} is not a sensor`);
    }

    const x = index % this.width;
    const y = (index - x) / this.width;
    const orientation = this.orientations[index] as Direction;
    const sensedX = x + directionX(orientation);
    const sensedY = y + directionY(orientation);
    return sensedX >= 0 &&
        sensedX < this.width &&
        sensedY >= 0 &&
        sensedY < this.height &&
        this.kinds[sensedY * this.width + sensedX] !== TileKind.Empty
      ? 1
      : 0;
  }

  hasRightWeldAtIndex(index: number): boolean {
    this.assertIndex(index);
    return index % this.width < this.width - 1 && this.rightWelds[index] === 1;
  }

  hasDownWeldAtIndex(index: number): boolean {
    this.assertIndex(index);
    return index < this.cellCount - this.width && this.downWelds[index] === 1;
  }
  hasWeldAtIndex(index: number, direction: Direction): boolean {
    this.assertIndex(index);
    const x = index % this.width;
    switch (direction) {
      case Direction.Up:
        return index >= this.width && this.downWelds[index - this.width] === 1;
      case Direction.Right:
        return x < this.width - 1 && this.rightWelds[index] === 1;
      case Direction.Down:
        return index < this.cellCount - this.width && this.downWelds[index] === 1;
      case Direction.Left:
        return x > 0 && this.rightWelds[index - 1] === 1;
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
    for (let base = 0; base < this.cellCount; base += 1) {
      const action = expectDefined(actions[base], "piston action");
      if (action === 0) {
        continue;
      }
      const orientation = this.orientations[base] as Direction;
      const arm = this.neighborIndex(base, orientation);
      if (arm < 0) {
        throw new Error(`Piston transition at index ${base} leaves the world`);
      }
      const head = this.neighborIndex(arm, orientation);
      const headWelded = expectDefined(headWelds[base], "piston head weld") === 1;

      if (action === 1) {
        if (this.kinds[base] !== TileKind.Piston || this.kinds[arm] !== TileKind.Empty) {
          throw new Error(`Invalid piston extension at index ${base}`);
        }
        const movingArmId = expectDefined(this.ids[base], "retracted piston ID");
        this.kinds[base] = TileKind.PistonBase;
        this.ids[base] = this.nextTileId;
        this.nextTileId += 1;
        this.kinds[arm] = TileKind.PistonArm;
        this.ids[arm] = movingArmId;
        this.orientations[arm] = orientation;
        this.charges[arm] = 0;
        this.crossingVerticalCharges[arm] = 0;
        this.isolatedOutputCharges[arm] = 0;
        this.furnaceProgress[arm] = 0;
        this.furnaceTargetIds[arm] = 0;
        this.setWeldAtIndices(base, arm, 1);
        if (head >= 0) {
          this.setWeldAtIndices(arm, head, headWelded ? 1 : 0);
        }
        this.clearDisallowedWeldsAtIndex(arm);
      } else if (action === -1) {
        if (this.kinds[base] !== TileKind.PistonBase) {
          throw new Error(`Invalid piston retraction at index ${base}`);
        }
        const movingArmId = expectDefined(armIds[base], "extended piston arm ID");
        if (movingArmId === 0) {
          throw new Error(`Piston retraction at index ${base} has no arm ID`);
        }
        this.kinds[base] = TileKind.Piston;
        this.ids[base] = movingArmId;
        if (headWelded) {
          if (this.kinds[arm] === TileKind.Empty) {
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
      this.revisionValue += 1;
    }
    return transitionCount;
  }


  moveBodies(
    bodyRoots: Int32Array,
    horizontalMoves: Int8Array,
    verticalMoves: Int8Array,
  ): number {
    if (
      bodyRoots.length !== this.cellCount ||
      horizontalMoves.length !== this.cellCount ||
      verticalMoves.length !== this.cellCount
    ) {
      throw new RangeError("Movement buffers must match the world cell count");
    }

    let movementCount = 0;
    for (let source = 0; source < this.cellCount; source += 1) {
      if (this.kinds[source] === TileKind.Empty) {
        continue;
      }
      const root = expectDefined(bodyRoots[source], "moving body root");
      const moveX = expectDefined(horizontalMoves[root], "horizontal body movement");
      const moveY = expectDefined(verticalMoves[root], "vertical body movement");
      if (moveX < -1 || moveX > 1 || moveY < -1 || moveY > 1) {
        throw new RangeError(`Invalid body movement (${moveX}, ${moveY})`);
      }
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

    this.movedKinds.set(this.kinds);
    this.movedIds.set(this.ids);
    this.movedOrientations.set(this.orientations);
    this.movedCharges.set(this.charges);
    this.movedCrossingVerticalCharges.set(this.crossingVerticalCharges);
    this.movedIsolatedOutputCharges.set(this.isolatedOutputCharges);
    this.movedFurnaceProgress.set(this.furnaceProgress);
    this.movedFurnaceTargetIds.set(this.furnaceTargetIds);
    this.movedRightWelds.set(this.rightWelds);
    this.movedDownWelds.set(this.downWelds);

    for (let source = 0; source < this.cellCount; source += 1) {
      if (this.kinds[source] === TileKind.Empty) {
        continue;
      }
      const root = expectDefined(bodyRoots[source], "moving body root");
      const moveX = expectDefined(horizontalMoves[root], "horizontal body movement");
      const moveY = expectDefined(verticalMoves[root], "vertical body movement");
      if (moveX === 0 && moveY === 0) {
        continue;
      }
      this.movedKinds[source] = TileKind.Empty;
      this.movedIds[source] = 0;
      this.movedOrientations[source] = Direction.Up;
      this.movedCharges[source] = 0;
      this.movedCrossingVerticalCharges[source] = 0;
      this.movedIsolatedOutputCharges[source] = 0;
      this.movedFurnaceProgress[source] = 0;
      this.movedFurnaceTargetIds[source] = 0;
      this.movedRightWelds[source] = 0;
      this.movedDownWelds[source] = 0;
    }

    for (let source = 0; source < this.cellCount; source += 1) {
      if (this.kinds[source] === TileKind.Empty) {
        continue;
      }
      const root = expectDefined(bodyRoots[source], "moving body root");
      const moveX = expectDefined(horizontalMoves[root], "horizontal body movement");
      const moveY = expectDefined(verticalMoves[root], "vertical body movement");
      if (moveX === 0 && moveY === 0) {
        continue;
      }
      const destination = source + moveX + moveY * this.width;
      this.movedKinds[destination] = expectDefined(this.kinds[source], "moving tile kind");
      this.movedIds[destination] = expectDefined(this.ids[source], "moving tile ID");
      this.movedOrientations[destination] = expectDefined(
        this.orientations[source],
        "moving tile orientation",
      );
      this.movedCharges[destination] = expectDefined(this.charges[source], "moving tile charge");
      this.movedCrossingVerticalCharges[destination] = expectDefined(
        this.crossingVerticalCharges[source],
        "moving crossing vertical charge",
      );
      this.movedIsolatedOutputCharges[destination] = expectDefined(
        this.isolatedOutputCharges[source],
        "moving isolated output charge",
      );
      this.movedFurnaceProgress[destination] = expectDefined(
        this.furnaceProgress[source],
        "moving furnace progress",
      );
      this.movedFurnaceTargetIds[destination] = expectDefined(
        this.furnaceTargetIds[source],
        "moving furnace target ID",
      );
      this.movedRightWelds[destination] = expectDefined(
        this.rightWelds[source],
        "moving right weld",
      );
      this.movedDownWelds[destination] = expectDefined(
        this.downWelds[source],
        "moving down weld",
      );
    }

    this.kinds.set(this.movedKinds);
    this.ids.set(this.movedIds);
    this.orientations.set(this.movedOrientations);
    this.charges.set(this.movedCharges);
    this.crossingVerticalCharges.set(this.movedCrossingVerticalCharges);
    this.isolatedOutputCharges.set(this.movedIsolatedOutputCharges);
    this.furnaceProgress.set(this.movedFurnaceProgress);
    this.furnaceTargetIds.set(this.movedFurnaceTargetIds);
    this.rightWelds.set(this.movedRightWelds);
    this.downWelds.set(this.movedDownWelds);
    this.revisionValue += 1;
    return movementCount;
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
    const direction = this.orientations[index] as Direction;
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
      return this.rightWelds[first] === 1;
    }
    if (difference === -1 && second % this.width < this.width - 1) {
      return this.rightWelds[second] === 1;
    }
    if (difference === this.width) {
      return this.downWelds[first] === 1;
    }
    if (difference === -this.width) {
      return this.downWelds[second] === 1;
    }
    throw new RangeError("A weld requires two orthogonally adjacent cells");
  }

  private setWeldAtIndices(first: number, second: number, value: 0 | 1): void {
    const difference = second - first;
    if (difference === 1 && first % this.width < this.width - 1) {
      this.rightWelds[first] = value;
    } else if (difference === -1 && second % this.width < this.width - 1) {
      this.rightWelds[second] = value;
    } else if (difference === this.width) {
      this.downWelds[first] = value;
    } else if (difference === -this.width) {
      this.downWelds[second] = value;
    } else {
      throw new RangeError("A weld requires two orthogonally adjacent cells");
    }
  }

  private weldStorage(first: number, second: number): { readonly welds: Uint8Array; readonly index: number } {
    const difference = second - first;
    if (difference === 1 && first % this.width < this.width - 1) {
      return { welds: this.rightWelds, index: first };
    }
    if (difference === -1 && second % this.width < this.width - 1) {
      return { welds: this.rightWelds, index: second };
    }
    if (difference === this.width) {
      return { welds: this.downWelds, index: first };
    }
    if (difference === -this.width) {
      return { welds: this.downWelds, index: second };
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

    const firstDefinition = TILE_DEFINITIONS[this.kinds[first] as TileKind];
    const secondDefinition = TILE_DEFINITIONS[this.kinds[second] as TileKind];
    const secondSide = oppositeDirection(firstSide);
    const firstWeldableSides = orientedSides(
      firstDefinition.weldableSides,
      this.orientations[first] as Direction,
    );
    const secondWeldableSides = orientedSides(
      secondDefinition.weldableSides,
      this.orientations[second] as Direction,
    );
    return (
      (firstWeldableSides & (1 << firstSide)) !== 0 &&
      (secondWeldableSides & (1 << secondSide)) !== 0 &&
      (!firstDefinition.excludesFacingWeld || this.orientations[first] !== firstSide) &&
      (!secondDefinition.excludesFacingWeld || this.orientations[second] !== secondSide)
    );
  }

  private clearDisallowedWeldsAtIndex(index: number): void {
    if (
      index % this.width < this.width - 1 &&
      this.rightWelds[index] === 1 &&
      !this.canWeldIndices(index, index + 1)
    ) {
      this.rightWelds[index] = 0;
    }
    if (
      index % this.width > 0 &&
      this.rightWelds[index - 1] === 1 &&
      !this.canWeldIndices(index - 1, index)
    ) {
      this.rightWelds[index - 1] = 0;
    }
    if (
      index < this.cellCount - this.width &&
      this.downWelds[index] === 1 &&
      !this.canWeldIndices(index, index + this.width)
    ) {
      this.downWelds[index] = 0;
    }
    if (
      index >= this.width &&
      this.downWelds[index - this.width] === 1 &&
      !this.canWeldIndices(index - this.width, index)
    ) {
      this.downWelds[index - this.width] = 0;
    }
  }

  private clearWeldsAtIndex(index: number): void {
    this.rightWelds[index] = 0;
    this.downWelds[index] = 0;
    if (index % this.width > 0) {
      this.rightWelds[index - 1] = 0;
    }
    if (index >= this.width) {
      this.downWelds[index - this.width] = 0;
    }
  }

  private requireComponentStateAtIndex(index: number): ConfigurableComponentState {
    this.assertIndex(index);
    const id = this.ids[index] ?? 0;
    if (id === 0) {
      throw new Error(`Configurable component at index ${index} has no tile identity`);
    }
    const state = this.componentStates.get(id);
    if (state === undefined) {
      throw new Error(`Configurable component at index ${index} has no state`);
    }
    const kind = this.kinds[index] as TileKind;
    if (!componentStateMatchesKind(state, kind)) {
      throw new Error(`Component state at index ${index} does not match ${TILE_DEFINITIONS[kind].name}`);
    }
    return state;
  }

  private clearIndex(index: number): void {
    const id = this.ids[index] ?? 0;
    if (id !== 0) {
      this.componentStates.delete(id);
    }
    this.kinds[index] = TileKind.Empty;
    this.orientations[index] = Direction.Up;
    this.charges[index] = 0;
    this.crossingVerticalCharges[index] = 0;
    this.isolatedOutputCharges[index] = 0;
    this.furnaceProgress[index] = 0;
    this.furnaceTargetIds[index] = 0;
    this.ids[index] = 0;
    this.clearWeldsAtIndex(index);
  }
}

function hasSeparateIsolatedOutput(kind: TileKind): boolean {
  const definition = TILE_DEFINITIONS[kind];
  const sharedPorts = definition.circuitPorts &
    ~(definition.circuitInputPorts | definition.circuitOutputPorts);
  return sharedPorts !== 0 && definition.circuitOutputPorts !== 0;
}
