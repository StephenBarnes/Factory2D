import { expectDefined } from "../util/assert";
import { Direction, directionX, directionY, TileKind } from "./tile";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

/** Observes targets before circuits; destroys surviving targets before motion. */
export class DrillResolver {
  private readonly targets: Int32Array;
  private readonly targetIds: Uint32Array;
  private readonly claims: Uint8Array;
  private targetCount = 0;

  constructor(private readonly world: World) {
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
      const orientation = world.orientationAtIndex(index);
      const side = ((orientation + Direction.Left) & 3) as Direction;
      if (world.chargeAtPortIndex(index, side) === -1) continue;
      const x = index % world.width + directionX(orientation);
      const y = Math.floor(index / world.width) + directionY(orientation);
      if (x < 0 || x >= world.width || y < 0 || y >= world.height) continue;
      const target = y * world.width + x;
      const id = world.idAtIndex(target);
      if (id === 0) continue;
      if (this.claims[target] !== 0) {
        this.claims[target] = 2;
        continue;
      }
      this.claims[target] = 1;
      this.targetIds[target] = id;
      this.targets[this.targetCount] = target;
      this.targetCount += 1;
    }
  }

  commit(): void {
    // Do not recheck drill existence here: mutually facing drills act simultaneously.
    // Earlier production/consumption may remove targets or replace them with fresh IDs.
    for (let offset = 0; offset < this.targetCount; offset += 1) {
      const target = expectDefined(this.targets[offset], "committed drill target");
      if (this.claims[target] !== 1 || this.world.idAtIndex(target) !== this.targetIds[target]) {
        continue;
      }
      this.world.place(target % this.world.width, Math.floor(target / this.world.width), TileKind.Empty);
    }
  }
}
