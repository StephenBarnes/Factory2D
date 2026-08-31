import { expectDefined } from "../util/assert";
import { Direction, oppositeDirection, TileKind } from "./tile";
import type { World } from "./world";

/** Collects delivery intents before circuits observe them, then commits absorption. */
export class DeliveryResolver {
  readonly absorptionTargetIndices: Int32Array;

  private readonly world: World;
  private readonly targetOwners: Int32Array;

  constructor(world: World) {
    this.world = world;
    this.targetOwners = new Int32Array(world.cellCount);
    this.absorptionTargetIndices = new Int32Array(world.cellCount);
  }

  collect(): void {
    this.targetOwners.fill(-1);
    this.absorptionTargetIndices.fill(-1);

    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (this.world.kindAtIndex(index) !== TileKind.Delivery) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(index);
      const targetIndex = this.neighborIndex(index, orientation);
      const referenceIndex = this.neighborIndex(index, oppositeDirection(orientation));
      if (targetIndex < 0 || referenceIndex < 0) {
        continue;
      }
      const targetKind = this.world.kindAtIndex(targetIndex);
      if (
        targetKind === TileKind.Empty ||
        targetKind !== this.world.kindAtIndex(referenceIndex)
      ) {
        continue;
      }

      const existingOwner = expectDefined(
        this.targetOwners[targetIndex],
        "delivery target owner",
      );
      if (existingOwner === -1) {
        this.targetOwners[targetIndex] = index;
        this.absorptionTargetIndices[index] = targetIndex;
      } else {
        if (existingOwner >= 0) {
          this.absorptionTargetIndices[existingOwner] = -1;
        }
        this.targetOwners[targetIndex] = -2;
      }
    }
  }

  commit(): void {
    this.world.applyDeliveryAbsorptions(this.absorptionTargetIndices);
  }

  private neighborIndex(index: number, direction: Direction): number {
    const x = index % this.world.width;
    switch (direction) {
      case Direction.Up:
        return index >= this.world.width ? index - this.world.width : -1;
      case Direction.Right:
        return x < this.world.width - 1 ? index + 1 : -1;
      case Direction.Down:
        return index < this.world.cellCount - this.world.width
          ? index + this.world.width
          : -1;
      case Direction.Left:
        return x > 0 ? index - 1 : -1;
      default:
        throw new RangeError(`Invalid direction ${direction as number}`);
    }
  }
}
