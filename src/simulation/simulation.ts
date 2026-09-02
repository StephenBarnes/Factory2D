import { CircuitResolver } from "./circuit-resolver";
import { MAX_RUNE_ARRAY_DEPTH } from "./rune-array";
import { TileKind } from "./tile";
import type { World } from "./world";
import { WorldRuntime } from "./world-runtime";

/**
 * Advances a world in discrete ticks. Every movement decision is collected from
 * the start-of-tick state, then committed as a separate phase.
 *
 * Rune arrays nest complete boards inside single tiles. Each tick first collects intents
 * in every world of that tree, then resolves all circuits together so signals cross array
 * boundaries without delay, and finally commits the remaining phases in every world with
 * children before their parents, so a duplicated array copies its fully advanced contents.
 */
export class Simulation {
  readonly world: World;
  private readonly circuitResolver = new CircuitResolver();
  private readonly rootRuntime: WorldRuntime;
  private readonly runtimesByWorld = new WeakMap<World, WorldRuntime>();
  private readonly runtimes: WorldRuntime[] = [];
  tick = 0;

  constructor(world: World) {
    this.world = world;
    this.rootRuntime = new WorldRuntime(world);
    this.runtimesByWorld.set(world, this.rootRuntime);
  }

  step(interpolationSource?: World): number {
    this.collectRuntimes();
    for (const runtime of this.runtimes) {
      runtime.collectIntents();
    }
    this.circuitResolver.resolve(this.tick, this.runtimes);
    let movementCount = 0;
    for (let position = this.runtimes.length - 1; position >= 0; position -= 1) {
      const runtime = this.runtimes[position];
      if (runtime === undefined) {
        throw new Error(`Missing world runtime at position ${position}`);
      }
      movementCount += runtime.commitPhases(
        this.tick,
        position === 0 ? interpolationSource : undefined,
      );
    }
    this.tick += 1;
    return movementCount;
  }

  resetTo(snapshot: World): void {
    this.world.copyFrom(snapshot);
    this.tick = 0;
  }

  /** Lists the root runtime followed by every nested world, parents before children. */
  private collectRuntimes(): void {
    this.runtimes.length = 0;
    this.rootRuntime.parent = null;
    this.rootRuntime.parentIndex = -1;
    this.rootRuntime.depth = 0;
    this.runtimes.push(this.rootRuntime);
    for (let position = 0; position < this.runtimes.length; position += 1) {
      const runtime = this.runtimes[position];
      if (runtime === undefined) {
        throw new Error(`Missing world runtime at position ${position}`);
      }
      const world = runtime.world;
      for (let index = 0; index < world.cellCount; index += 1) {
        if (world.kindAtIndex(index) !== TileKind.RuneArray) {
          continue;
        }
        if (runtime.depth >= MAX_RUNE_ARRAY_DEPTH) {
          throw new Error(`Rune arrays nest deeper than ${MAX_RUNE_ARRAY_DEPTH} levels`);
        }
        const innerWorld = world.runeArrayWorldAtIndex(index);
        let inner = this.runtimesByWorld.get(innerWorld);
        if (inner === undefined) {
          inner = new WorldRuntime(innerWorld);
          this.runtimesByWorld.set(innerWorld, inner);
        }
        inner.parent = runtime;
        inner.parentIndex = index;
        inner.depth = runtime.depth + 1;
        this.runtimes.push(inner);
      }
    }
  }
}
