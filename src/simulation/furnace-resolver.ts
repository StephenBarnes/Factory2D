import { furnaceRecipeFor } from "./furnace";
import { Direction, TileKind } from "./tile";
import type { World } from "./world";

/** Resolves and commits furnace progress using persistent, allocation-free scratch buffers. */
export class FurnaceResolver {
  private readonly world: World;
  private readonly nextProgress: Uint16Array;
  private readonly nextTargetIds: Uint32Array;
  private readonly transformTargetIndices: Int32Array;
  private readonly transformKinds: Uint8Array;

  constructor(world: World) {
    this.world = world;
    this.nextProgress = new Uint16Array(world.cellCount);
    this.nextTargetIds = new Uint32Array(world.cellCount);
    this.transformTargetIndices = new Int32Array(world.cellCount);
    this.transformKinds = new Uint8Array(world.cellCount);
  }

  resolve(disabledFurnaces: Uint8Array): void {
    this.nextProgress.fill(0);
    this.nextTargetIds.fill(0);
    this.transformTargetIndices.fill(-1);
    this.transformKinds.fill(TileKind.Empty);

    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (this.world.kindAtIndex(index) !== TileKind.Furnace) {
        continue;
      }

      const targetIndex = this.neighborIndex(index, this.world.orientationAtIndex(index));
      if (targetIndex < 0) {
        continue;
      }
      const recipe = furnaceRecipeFor(this.world.kindAtIndex(targetIndex));
      if (recipe === undefined) {
        continue;
      }
      const targetId = this.world.idAtIndex(targetIndex);
      const previousTargetId = this.world.furnaceTargetIdAtIndex(index);
      const previousProgress = this.world.furnaceProgressAtIndex(index);
      if (disabledFurnaces[index] === 1) {
        if (targetId === previousTargetId && previousProgress > 0) {
          this.nextProgress[index] = previousProgress;
          this.nextTargetIds[index] = targetId;
        }
        continue;
      }

      const progress = targetId === previousTargetId ? previousProgress + 1 : 1;
      this.nextTargetIds[index] = targetId;
      if (progress < recipe.bakeTime) {
        this.nextProgress[index] = progress;
        continue;
      }
      this.transformTargetIndices[index] = targetIndex;
      this.transformKinds[index] = recipe.output;
    }

    this.world.applyFurnaceResults(
      this.nextProgress,
      this.nextTargetIds,
      this.transformTargetIndices,
      this.transformKinds,
    );
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
