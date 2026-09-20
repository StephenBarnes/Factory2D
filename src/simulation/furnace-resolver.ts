import { expectDefined } from "../util/assert";
import { furnaceNeighborsPresent, processingRecipeFor } from "./furnace";
import { Direction, TileKind } from "./tile";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

/** Resolves furnace and grinder progress using persistent, allocation-free scratch buffers. */
export class FurnaceResolver {
  private readonly world: World;
  private readonly nextProgress: Uint16Array;
  private readonly nextTargetIds: Uint32Array;
  private readonly transformTargetIndices: Int32Array;
  private readonly transformKinds: Uint8Array;
  private readonly transformInputs: Uint8Array;
  private readonly neighborTargets: number[] = [];
  private readonly neighborInputs: TileKind[] = [];
  private readonly neighborOutputs: TileKind[] = [];

  constructor(world: World) {
    this.world = world;
    this.nextProgress = new Uint16Array(world.cellCount);
    this.nextTargetIds = new Uint32Array(world.cellCount);
    this.transformTargetIndices = new Int32Array(world.cellCount);
    this.transformKinds = new Uint8Array(world.cellCount);
    this.transformInputs = new Uint8Array(world.cellCount);
  }

  resolve(disabledFurnaces: Uint8Array): void {
    let neighborCount = 0;

    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Furnace);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Furnace, index)
    ) {
      this.nextProgress[index] = 0;
      this.nextTargetIds[index] = 0;
      this.transformTargetIndices[index] = -1;
      this.transformKinds[index] = TileKind.Empty;

      const targetIndex = this.neighborIndex(index, this.world.orientationAtIndex(index));
      if (targetIndex < 0) {
        continue;
      }
      const recipe = processingRecipeFor(this.world.kindAtIndex(index), this.world.kindAtIndex(targetIndex));
      if (recipe === undefined) {
        continue;
      }
      const targetId = this.world.idAtIndex(targetIndex);
      const previousTargetId = this.world.furnaceTargetIdAtIndex(index);
      const previousProgress = this.world.furnaceProgressAtIndex(index);
      if (disabledFurnaces[index] === 1 || !furnaceNeighborsPresent(this.world, targetIndex, recipe)) {
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
      this.transformInputs[index] = recipe.input;
      // Capture catalysts before any product changes the surrounding material.
      if (recipe.requiredNeighbors === undefined) continue;
      for (const requirement of recipe.requiredNeighbors) {
        if (requirement.output === undefined) continue;
        for (let direction = Direction.Up; direction <= Direction.Left; direction += 1) {
          const neighbor = this.neighborIndex(targetIndex, direction);
          if (neighbor < 0 || this.world.kindAtIndex(neighbor) !== requirement.kind) continue;
          this.neighborTargets[neighborCount] = neighbor;
          this.neighborInputs[neighborCount] = requirement.kind;
          this.neighborOutputs[neighborCount] = requirement.output;
          neighborCount += 1;
        }
      }
    }

    this.world.applyFurnaceResults(
      this.nextProgress,
      this.nextTargetIds,
      this.transformTargetIndices,
      this.transformKinds,
    );

    for (let position = 0; position < neighborCount; position += 1) {
      const target = expectDefined(this.neighborTargets[position], "furnace catalyst target");
      const input = expectDefined(this.neighborInputs[position], "furnace catalyst input");
      // Shared catalysts and directly cooked wood may already have transformed.
      if (this.world.kindAtIndex(target) !== input) continue;
      const output = expectDefined(this.neighborOutputs[position], "furnace catalyst output");
      this.world.place(target % this.world.width, Math.floor(target / this.world.width), output);
    }

    // Observe neighbors after every transformation, so simultaneous products join
    // independently of furnace order, but only on their completion tick.
    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Furnace);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Furnace, index)
    ) {
      const target = expectDefined(this.transformTargetIndices[index], "furnace weld target");
      if (target < 0) continue;
      const input = expectDefined(this.transformInputs[index], "furnace transform input");
      const recipe = expectDefined(
        processingRecipeFor(this.world.kindAtIndex(index), input),
        "completed furnace recipe",
      );
      if (recipe.weldTo === undefined) continue;
      for (let direction = Direction.Up; direction <= Direction.Left; direction += 1) {
        const neighbor = this.neighborIndex(target, direction);
        if (neighbor < 0 || !recipe.weldTo.includes(this.world.kindAtIndex(neighbor))) continue;
        this.world.setWeld(
          target % this.world.width,
          Math.floor(target / this.world.width),
          neighbor % this.world.width,
          Math.floor(neighbor / this.world.width),
          true,
        );
      }
    }
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
