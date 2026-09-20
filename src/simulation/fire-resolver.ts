import { expectDefined } from "../util/assert";
import { Direction, directionX, directionY, TileKind } from "./tile";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

/** Each retained five-cell intent contains a fire followed by its four observed neighbors. */
export class FireResolver {
  private readonly world: World;
  private readonly indices: number[] = [];
  private readonly ids: number[] = [];
  private count = 0;

  constructor(world: World) {
    this.world = world;
  }

  collect(): void {
    const world = this.world;
    this.count = 0;
    for (
      let index = world.firstFeatureIndex(WorldFeature.Fire);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.Fire, index)
    ) {
      this.indices[this.count] = index;
      this.ids[this.count] = world.idAtIndex(index);
      this.count += 1;
      const x = index % world.width;
      const y = Math.floor(index / world.width);
      for (let direction = Direction.Up; direction <= Direction.Left; direction += 1) {
        const nx = x + directionX(direction);
        const ny = y + directionY(direction);
        const neighbor = nx < 0 || nx >= world.width || ny < 0 || ny >= world.height
          ? -1
          : ny * world.width + nx;
        const target = neighbor >= 0 && world.kindAtIndex(neighbor) === TileKind.Wood
          ? neighbor
          : -1;
        this.indices[this.count] = target;
        this.ids[this.count] = target < 0 ? 0 : world.idAtIndex(target);
        this.count += 1;
      }
    }
  }

  commit(): void {
    const world = this.world;
    for (let base = 0; base < this.count; base += 5) {
      const source = expectDefined(this.indices[base], "observed fire index");
      const sourceId = expectDefined(this.ids[base], "observed fire ID");
      if (world.kindAtIndex(source) !== TileKind.Fire || world.idAtIndex(source) !== sourceId) {
        continue; // Earlier machinery consumed the observed fire.
      }
      world.place(source % world.width, Math.floor(source / world.width), TileKind.Empty);
      for (let offset = 1; offset <= 4; offset += 1) {
        const position = base + offset;
        const target = expectDefined(this.indices[position], "observed fire neighbor");
        const targetId = expectDefined(this.ids[position], "observed fire neighbor ID");
        if (target < 0 || world.kindAtIndex(target) !== TileKind.Wood ||
            world.idAtIndex(target) !== targetId) {
          continue; // Absent, already ignited, or consumed/replaced by earlier machinery.
        }
        // Wood is consumed, not moved: replacement gets a fresh ID and loses every weld.
        world.place(target % world.width, Math.floor(target / world.width), TileKind.Fire);
      }
    }
  }
}
