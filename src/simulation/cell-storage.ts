import { expectDefined } from "../util/assert";
import { Direction, TileKind } from "./tile";

/**
 * The dense per-cell arrays of one board: tile kind, stable ID, orientation, circuit
 * charges, furnace state, and the weld edges toward the right and down neighbors.
 *
 * Bundling them keeps every whole-board and whole-cell copy in one place, so a new per-cell
 * field only has to be added here. `World` layers the invariants on top: feature indexing,
 * component state, revisions, and weld legality.
 */
export class CellStorage {
  readonly kinds: Uint8Array;
  readonly ids: Uint32Array;
  readonly orientations: Uint8Array;
  readonly charges: Int8Array;
  readonly crossingVerticalCharges: Int8Array;
  readonly isolatedOutputCharges: Int8Array;
  readonly furnaceProgress: Uint16Array;
  readonly furnaceTargetIds: Uint32Array;
  readonly rightWelds: Uint8Array;
  readonly downWelds: Uint8Array;

  constructor(readonly cellCount: number) {
    this.kinds = new Uint8Array(cellCount);
    this.ids = new Uint32Array(cellCount);
    this.orientations = new Uint8Array(cellCount);
    this.charges = new Int8Array(cellCount);
    this.crossingVerticalCharges = new Int8Array(cellCount);
    this.isolatedOutputCharges = new Int8Array(cellCount);
    this.furnaceProgress = new Uint16Array(cellCount);
    this.furnaceTargetIds = new Uint32Array(cellCount);
    this.rightWelds = new Uint8Array(cellCount);
    this.downWelds = new Uint8Array(cellCount);
  }

  /** Empties every cell and removes every weld. */
  clear(): void {
    this.kinds.fill(TileKind.Empty);
    this.ids.fill(0);
    this.orientations.fill(Direction.Up);
    this.charges.fill(0);
    this.crossingVerticalCharges.fill(0);
    this.isolatedOutputCharges.fill(0);
    this.furnaceProgress.fill(0);
    this.furnaceTargetIds.fill(0);
    this.rightWelds.fill(0);
    this.downWelds.fill(0);
  }

  copyFrom(source: CellStorage): void {
    if (source.cellCount !== this.cellCount) {
      throw new RangeError("Cannot copy cell storage with a different cell count");
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
  }

  /** Empties one cell, including the weld edges it owns toward its right and down neighbors. */
  clearCell(index: number): void {
    this.kinds[index] = TileKind.Empty;
    this.ids[index] = 0;
    this.orientations[index] = Direction.Up;
    this.resetTransientState(index);
    this.rightWelds[index] = 0;
    this.downWelds[index] = 0;
  }

  /** Zeroes the charges and furnace state of one cell, keeping kind, ID, orientation, and welds. */
  resetTransientState(index: number): void {
    this.charges[index] = 0;
    this.crossingVerticalCharges[index] = 0;
    this.isolatedOutputCharges[index] = 0;
    this.furnaceProgress[index] = 0;
    this.furnaceTargetIds[index] = 0;
  }

  /** Copies every field of `source`'s cell `from` into this storage's cell `to`, welds included. */
  copyCell(source: CellStorage, from: number, to: number): void {
    this.kinds[to] = expectDefined(source.kinds[from], "copied tile kind");
    this.ids[to] = expectDefined(source.ids[from], "copied tile ID");
    this.orientations[to] = expectDefined(source.orientations[from], "copied tile orientation");
    this.charges[to] = expectDefined(source.charges[from], "copied tile charge");
    this.crossingVerticalCharges[to] = expectDefined(
      source.crossingVerticalCharges[from],
      "copied crossing vertical charge",
    );
    this.isolatedOutputCharges[to] = expectDefined(
      source.isolatedOutputCharges[from],
      "copied isolated output charge",
    );
    this.furnaceProgress[to] = expectDefined(source.furnaceProgress[from], "copied furnace progress");
    this.furnaceTargetIds[to] = expectDefined(source.furnaceTargetIds[from], "copied furnace target ID");
    this.rightWelds[to] = expectDefined(source.rightWelds[from], "copied right weld");
    this.downWelds[to] = expectDefined(source.downWelds[from], "copied down weld");
  }
}
