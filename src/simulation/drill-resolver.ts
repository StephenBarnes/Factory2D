import { expectDefined } from "../util/assert";
import { DRILL_TICKS, processingRecipeFor } from "./furnace";
import { recordShatterAnimation } from "./shatter-animation";
import { Direction, directionX, directionY, TILE_DEFINITIONS, TileKind } from "./tile";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

/** Observes targets before circuits; destroys surviving targets before motion. */
export class DrillResolver {
  readonly activeDrills: Uint8Array;
  private readonly nextProgress: Uint16Array;
  private readonly nextTargetIds: Uint32Array;
  private readonly drillIds: Uint32Array;
  private readonly targetDrills: Int32Array;
  private readonly targets: Int32Array;
  private readonly targetIds: Uint32Array;
  private readonly claims: Uint8Array;
  private targetCount = 0;

  constructor(private readonly world: World) {
    this.activeDrills = new Uint8Array(world.cellCount);
    this.nextProgress = new Uint16Array(world.cellCount);
    this.nextTargetIds = new Uint32Array(world.cellCount);
    this.drillIds = new Uint32Array(world.cellCount);
    this.targetDrills = new Int32Array(world.cellCount);
    this.targets = new Int32Array(world.cellCount);
    this.targetIds = new Uint32Array(world.cellCount);
    this.claims = new Uint8Array(world.cellCount);
  }

  collect(): void {
    const world = this.world;
    for (let offset = 0; offset < this.targetCount; offset += 1) {
      this.claims[expectDefined(this.targets[offset], "previous drill target")] = 0;
    }
    this.targetCount = 0;
    for (
      let index = world.firstFeatureIndex(WorldFeature.Drill);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.Drill, index)
    ) {
      this.activeDrills[index] = 0;
      this.nextProgress[index] = 0;
      this.nextTargetIds[index] = 0;
      this.drillIds[index] = world.idAtIndex(index);
      const orientation = world.orientationAtIndex(index);
      const side = ((orientation + Direction.Left) & 3) as Direction;
      const x = index % world.width + directionX(orientation);
      const y = Math.floor(index / world.width) + directionY(orientation);
      if (x < 0 || x >= world.width || y < 0 || y >= world.height) continue;
      const target = y * world.width + x;
      const id = world.idAtIndex(target);
      if (processingRecipeFor(TileKind.Drill, world.kindAtIndex(target)) === undefined) continue;
      this.nextTargetIds[index] = id;
      if (world.furnaceTargetIdAtIndex(index) === id) {
        this.nextProgress[index] = world.furnaceProgressAtIndex(index);
      }
      if (world.chargeAtPortIndex(index, side) === -1) continue;
      if (this.claims[target] !== 0) {
        this.claims[target] = 2;
        continue;
      }
      this.claims[target] = 1;
      this.targetIds[target] = id;
      this.targetDrills[target] = index;
      this.targets[this.targetCount] = target;
      this.targetCount += 1;
    }
    for (let offset = 0; offset < this.targetCount; offset += 1) {
      const target = expectDefined(this.targets[offset], "observed drill target");
      if (this.claims[target] !== 1) continue;
      const drill = expectDefined(this.targetDrills[target], "targeting drill");
      this.activeDrills[drill] = 1;
      this.nextProgress[drill] = expectDefined(this.nextProgress[drill], "drill progress") + 1;
    }
  }

  commit(): void {
    // Store every drill's progress before destruction can remove another drill.
    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Drill);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Drill, index)
    ) {
      // Production may have copied a new drill here after observation; keep its copied state.
      if (this.world.idAtIndex(index) !== this.drillIds[index]) continue;
      const orientation = this.world.orientationAtIndex(index);
      const x = index % this.world.width + directionX(orientation);
      const y = Math.floor(index / this.world.width) + directionY(orientation);
      const progress = expectDefined(this.nextProgress[index], "committed drill progress");
      const targetId = expectDefined(this.nextTargetIds[index], "committed drill target ID");
      const keepProgress = progress > 0 && progress < DRILL_TICKS &&
        x >= 0 && x < this.world.width && y >= 0 && y < this.world.height &&
        this.world.idAt(x, y) === targetId &&
        processingRecipeFor(TileKind.Drill, this.world.kindAt(x, y)) !== undefined;
      this.world.applyDrillProgress(index, keepProgress ? progress : 0, keepProgress ? targetId : 0);
    }
    // Do not recheck drill existence here: mutually facing drills act simultaneously.
    // Earlier production/consumption may remove targets or replace them with fresh IDs.
    for (let offset = 0; offset < this.targetCount; offset += 1) {
      const target = expectDefined(this.targets[offset], "committed drill target");
      const drill = expectDefined(this.targetDrills[target], "committed targeting drill");
      if (this.nextProgress[drill] !== DRILL_TICKS) continue;
      if (this.claims[target] !== 1 || this.world.idAtIndex(target) !== this.targetIds[target]) {
        continue;
      }
      if (TILE_DEFINITIONS[this.world.kindAtIndex(target)].indestructible) continue;
      recordShatterAnimation(this.world, target);
      this.world.place(target % this.world.width, Math.floor(target / this.world.width), TileKind.Empty);
    }
  }
}
