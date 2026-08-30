import { TILE_DEFINITIONS, TileKind } from "./tile";
import { World } from "./world";

/**
 * Advances a world in discrete ticks. Every movement decision is collected from
 * the start-of-tick state, then committed as a separate phase.
 */
export class Simulation {
  readonly world: World;
  tick = 0;

  private readonly movementSources: Int32Array;

  constructor(world: World) {
    this.world = world;
    this.movementSources = new Int32Array(world.cellCount);
  }

  step(): number {
    let movementCount = 0;
    const lastMovableIndex = this.world.cellCount - this.world.width;

    for (let index = 0; index < lastMovableIndex; index += 1) {
      const kind = this.world.kindAtIndex(index);
      if (
        kind !== TileKind.Empty &&
        TILE_DEFINITIONS[kind].affectedByGravity &&
        this.world.kindAtIndex(index + this.world.width) === TileKind.Empty
      ) {
        this.movementSources[movementCount] = index;
        movementCount += 1;
      }
    }

    for (let movement = 0; movement < movementCount; movement += 1) {
      const source = this.movementSources[movement];
      if (source === undefined) {
        throw new Error("Simulation movement buffer was unexpectedly incomplete");
      }
      this.world.moveIndex(source, source + this.world.width);
    }

    this.tick += 1;
    return movementCount;
  }

  resetTo(snapshot: World): void {
    this.world.copyFrom(snapshot);
    this.tick = 0;
  }
}
