import { expectDefined } from "../util/assert";
import { recordMachineryActivity } from "./machinery-activity";
import { Direction, TILE_DEFINITIONS, TileKind } from "./tile";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

/** Retains source identities before production, then commits the union of live charged blasts. */
export class BombResolver {
  private readonly world: World;
  private readonly indices: number[] = [];
  private readonly ids: number[] = [];
  private readonly targets: number[] = [];
  private targeted: Uint8Array | undefined;
  private count = 0;

  constructor(world: World) {
    this.world = world;
  }

  collect(): void {
    const world = this.world;
    this.count = 0;
    for (
      let index = world.firstFeatureIndex(WorldFeature.Bomb);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.Bomb, index)
    ) {
      this.indices[this.count] = index;
      this.ids[this.count] = world.idAtIndex(index);
      this.count += 1;
    }
  }

  commit(): void {
    const world = this.world;
    let targetCount = 0;
    for (let position = 0; position < this.count; position += 1) {
      const source = expectDefined(this.indices[position], "observed bomb index");
      const sourceId = expectDefined(this.ids[position], "observed bomb ID");
      if (world.kindAtIndex(source) !== TileKind.Bomb || world.idAtIndex(source) !== sourceId ||
          world.chargeAtPortIndex(source, Direction.Up) === 0) {
        continue;
      }
      recordMachineryActivity(world, "bomb", source);
      const targeted = this.targeted ??= new Uint8Array(world.cellCount);
      const sourceX = source % world.width;
      const sourceY = Math.floor(source / world.width);
      for (let y = Math.max(0, sourceY - 1); y <= Math.min(world.height - 1, sourceY + 1); y += 1) {
        for (let x = Math.max(0, sourceX - 1); x <= Math.min(world.width - 1, sourceX + 1); x += 1) {
          const target = y * world.width + x;
          if (targeted[target] !== 0 || TILE_DEFINITIONS[world.kindAtIndex(target)].indestructible) continue;
          targeted[target] = 1;
          this.targets[targetCount] = target;
          targetCount += 1;
        }
      }
    }
    // No replacements precede source selection: overlapping charged bombs all detonate,
    // while an uncharged bomb in the blast is only consumed, never chained.
    for (let position = 0; position < targetCount; position += 1) {
      const target = expectDefined(this.targets[position], "bomb blast target");
      expectDefined(this.targeted, "bomb blast marks")[target] = 0;
      const x = target % world.width;
      const y = Math.floor(target / world.width);
      // World.place preserves an existing same-kind ID; even existing flames must be fresh.
      if (world.kindAtIndex(target) === TileKind.Fire) world.place(x, y, TileKind.Empty);
      world.place(x, y, TileKind.Fire);
    }
  }
}
