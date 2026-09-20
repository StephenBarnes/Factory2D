import { bellPitchForBodySize } from "./bell-pitch";
import { TileKind } from "./tile";
import { WeldedBodyIndex } from "./welded-body-index";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

export interface TonalEvent {
  readonly index: number;
  readonly pitch: number;
}

/** Tick-local sound observations; no traversal, mutation, or serialized state. */
export class TonalObserver {
  private readonly initialIndices = new Map<number, number>();
  private readonly events: TonalEvent[] = [];
  private readonly eventPool: { index: number; pitch: number }[] = [];
  private bodies?: WeldedBodyIndex;
  private pending = false;

  constructor(private readonly world: World) {}

  capture(): void {
    this.events.length = 0;
    this.initialIndices.clear();
    this.pending = true;
    this.captureFeature(WorldFeature.Bell);
    this.captureFeature(WorldFeature.Mallet);
  }

  /** Consume the capture. The returned events are reused by subsequent observations. */
  collect(bodies?: WeldedBodyIndex): readonly TonalEvent[] {
    this.events.length = 0;
    if (!this.pending) return this.events;
    this.pending = false;
    const world = this.world;
    let finalBodies: WeldedBodyIndex | undefined;
    for (
      let index = world.firstFeatureIndex(WorldFeature.Bell);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.Bell, index)
    ) {
      const initial = this.initialIndices.get(world.idAtIndex(index));
      if (initial === undefined || initial % world.width === index % world.width) continue;
      if (finalBodies === undefined) {
        finalBodies = bodies ?? (this.bodies ??= new WeldedBodyIndex(world));
        finalBodies.collect();
      }
      this.addEvent(index, finalBodies.rootAt(index), finalBodies);
    }
    for (
      let index = world.firstFeatureIndex(WorldFeature.Mallet);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.Mallet, index)
    ) {
      const initial = this.initialIndices.get(world.idAtIndex(index));
      if (initial === undefined || initial === index) continue;
      const x = index % world.width;
      const y = (index - x) / world.width;
      const initialX = initial % world.width;
      const initialY = (initial - initialX) / world.width;
      const dx = Math.sign(x - initialX);
      const dy = Math.sign(y - initialY);
      const horizontal = dx !== 0 && x + dx >= 0 && x + dx < world.width ? index + dx : -1;
      const vertical = dy !== 0 && y + dy >= 0 && y + dy < world.height ? index + dy * world.width : -1;
      if (finalBodies === undefined) {
        finalBodies = bodies ?? (this.bodies ??= new WeldedBodyIndex(world));
        finalBodies.collect();
      }
      const ownRoot = finalBodies.rootAt(index);
      const struckRoot = this.strike(horizontal, ownRoot, -1, finalBodies);
      this.strike(vertical, ownRoot, struckRoot, finalBodies);
    }
    return this.events;
  }

  private captureFeature(feature: WorldFeature): void {
    for (
      let index = this.world.firstFeatureIndex(feature);
      index >= 0;
      index = this.world.nextFeatureIndex(feature, index)
    ) {
      this.initialIndices.set(this.world.idAtIndex(index), index);
    }
  }

  private strike(index: number, ownRoot: number, previousRoot: number, bodies: WeldedBodyIndex): number {
    if (index < 0 || this.world.kindAtIndex(index) === TileKind.Empty) return -1;
    const root = bodies.rootAt(index);
    if (root === ownRoot || root === previousRoot) return -1;
    this.addEvent(index, root, bodies);
    return root;
  }

  private addEvent(index: number, root: number, bodies: WeldedBodyIndex): void {
    const pitch = bellPitchForBodySize(bodies.memberCountAtRoot(root));
    let event = this.eventPool[this.events.length];
    if (event === undefined) {
      event = { index, pitch };
      this.eventPool.push(event);
    } else {
      event.index = index;
      event.pitch = pitch;
    }
    this.events.push(event);
  }
}
