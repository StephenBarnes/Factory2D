import { isCharge, type Charge } from "./circuit";
import { furnaceRecipeFor } from "./furnace";
import {
  Direction,
  directionX,
  directionY,
  oppositeDirection,
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
  private readonly furnaceProgress: Uint16Array;
  private readonly furnaceTargetIds: Uint32Array;
  private nextTileId = 1;
  private readonly rightWelds: Uint8Array;
  private readonly downWelds: Uint8Array;
  private revisionValue = 0;

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
    this.furnaceProgress = new Uint16Array(this.cellCount);
    this.furnaceTargetIds = new Uint32Array(this.cellCount);
    this.rightWelds = new Uint8Array(this.cellCount);
    this.downWelds = new Uint8Array(this.cellCount);
  }

  /** Monotonically increases whenever this world's renderable state may have changed. */
  get revision(): number {
    return this.revisionValue;
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

  applyCircuitCharges(charges: Int8Array, crossingVerticalCharges: Int8Array): void {
    if (
      charges.length !== this.cellCount ||
      crossingVerticalCharges.length !== this.cellCount
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
      if (!isCharge(charge) || !isCharge(verticalCharge)) {
        throw new RangeError(`Invalid circuit charges ${charge}, ${verticalCharge}`);
      }
      const kind = this.kinds[index] as TileKind;
      if (charge !== 0 && TILE_DEFINITIONS[kind].circuitPorts === 0) {
        throw new Error(`Non-circuit tile at index ${index} cannot hold charge`);
      }
      if (verticalCharge !== 0 && kind !== TileKind.WireCrossing) {
        throw new Error(`Non-crossing tile at index ${index} cannot hold vertical charge`);
      }
      if (
        this.charges[index] !== charge ||
        this.crossingVerticalCharges[index] !== verticalCharge
      ) {
        this.charges[index] = charge;
        this.crossingVerticalCharges[index] = verticalCharge;
        changed = true;
      }
    }
    if (changed) {
      this.revisionValue += 1;
    }
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
      this.kinds[targetIndex] = outputKind;
      this.orientations[targetIndex] = Direction.Up;
      this.charges[targetIndex] = 0;
      this.crossingVerticalCharges[targetIndex] = 0;
      this.furnaceProgress[targetIndex] = 0;
      this.furnaceTargetIds[targetIndex] = 0;
      this.clearDisallowedWeldsAtIndex(targetIndex);
      changed = true;
    }

    if (changed) {
      this.revisionValue += 1;
    }
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
        this.furnaceProgress[index] = 0;
        this.furnaceTargetIds[index] = 0;
        this.clearDisallowedWeldsAtIndex(index);
        this.revisionValue += 1;
      }
      return this.ids[index] ?? 0;
    }
    this.clearWeldsAtIndex(index);

    const id = this.nextTileId;
    this.nextTileId += 1;
    this.kinds[index] = kind;
    this.ids[index] = id;
    this.charges[index] = 0;
    this.crossingVerticalCharges[index] = 0;
    this.furnaceProgress[index] = 0;
    this.furnaceTargetIds[index] = 0;
    this.orientations[index] = orientation;
    this.revisionValue += 1;
    return id;
  }

  clear(): void {
    this.kinds.fill(TileKind.Empty);
    this.ids.fill(0);
    this.orientations.fill(Direction.Up);
    this.charges.fill(0);
    this.crossingVerticalCharges.fill(0);
    this.furnaceProgress.fill(0);
    this.furnaceTargetIds.fill(0);
    this.rightWelds.fill(0);
    this.downWelds.fill(0);
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
    this.furnaceProgress.set(source.furnaceProgress);
    this.furnaceTargetIds.set(source.furnaceTargetIds);
    this.rightWelds.set(source.rightWelds);
    this.downWelds.set(source.downWelds);
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
    return this.kinds[index] === TileKind.WireCrossing &&
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

  moveBodiesDown(bodyRoots: Int32Array, horizontalMoves: Int8Array): number {
    if (bodyRoots.length !== this.cellCount || horizontalMoves.length !== this.cellCount) {
      throw new RangeError("Movement buffers must match the world cell count");
    }

    let movementCount = 0;
    for (let source = this.cellCount - 1; source >= 0; source -= 1) {
      if (this.kinds[source] === TileKind.Empty) {
        continue;
      }

      const root = bodyRoots[source] ?? -1;
      const horizontalMove = horizontalMoves[root] ?? 2;
      if (horizontalMove < -1 || horizontalMove > 1) {
        continue;
      }

      const destination = source + this.width + horizontalMove;
      this.kinds[destination] = this.kinds[source] ?? TileKind.Empty;
      this.ids[destination] = this.ids[source] ?? 0;
      this.orientations[destination] = this.orientations[source] ?? Direction.Up;
      this.charges[destination] = expectDefined(this.charges[source], "moving tile charge");
      this.crossingVerticalCharges[destination] = expectDefined(
        this.crossingVerticalCharges[source],
        "moving crossing vertical charge",
      );
      this.furnaceProgress[destination] = this.furnaceProgress[source] ?? 0;
      this.furnaceTargetIds[destination] = this.furnaceTargetIds[source] ?? 0;
      this.rightWelds[destination] = this.rightWelds[source] ?? 0;
      this.downWelds[destination] = this.downWelds[source] ?? 0;
      this.kinds[source] = TileKind.Empty;
      this.ids[source] = 0;
      this.orientations[source] = Direction.Up;
      this.charges[source] = 0;
      this.crossingVerticalCharges[source] = 0;
      this.furnaceProgress[source] = 0;
      this.furnaceTargetIds[source] = 0;
      this.rightWelds[source] = 0;
      this.downWelds[source] = 0;
      movementCount += 1;
    }
    if (movementCount > 0) {
      this.revisionValue += 1;
    }
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
    return (
      (firstDefinition.weldableSides & (1 << firstSide)) !== 0 &&
      (secondDefinition.weldableSides & (1 << secondSide)) !== 0 &&
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

  private clearIndex(index: number): void {
    this.kinds[index] = TileKind.Empty;
    this.orientations[index] = Direction.Up;
    this.charges[index] = 0;
    this.crossingVerticalCharges[index] = 0;
    this.furnaceProgress[index] = 0;
    this.furnaceTargetIds[index] = 0;
    this.ids[index] = 0;
    this.clearWeldsAtIndex(index);
  }
}
