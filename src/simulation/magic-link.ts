import { expectDefined } from "../util/assert";
import { Direction } from "./tile";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

const indices = new WeakMap<World, MagicLinkIndex>();

/** No topology buffers are allocated on boards that have never contained magic links. */
export function magicLinksFor(world: World): MagicLinkIndex | undefined {
  let index = indices.get(world);
  if (index === undefined && world.hasFeature(WorldFeature.MagicLink)) {
    index = new MagicLinkIndex(world);
    indices.set(world, index);
  }
  return index;
}

/**
 * Mechanical edges only: neither occupied ray cells nor circuit connections.
 * Controls are observed before body-dependent intents, then held by stable ID for
 * every phase. Geometry is rebuilt after movement/production, including piston rounds.
 */
class MagicLinkIndex {
  private readonly heads: Int32Array;
  private readonly columnTargets: Int32Array;
  private targets = new Int32Array(0);
  private next = new Int32Array(0);
  private edgeCount = 0;
  private disabled = new Set<number>();
  private nextDisabled = new Set<number>();
  private geometryRevision = -1;
  private controlsChanged = false;
  revision = 0;

  constructor(private readonly world: World) {
    this.heads = new Int32Array(world.cellCount);
    this.columnTargets = new Int32Array(world.width);
    this.heads.fill(-1);
  }

  beginControls(): void {
    this.nextDisabled.clear();
  }

  disable(index: number): void {
    this.nextDisabled.add(this.world.idAtIndex(index));
  }

  commitControls(): void {
    if (this.disabled.size !== this.nextDisabled.size) {
      this.controlsChanged = true;
    } else {
      for (const id of this.nextDisabled) {
        if (!this.disabled.has(id)) {
          this.controlsChanged = true;
          break;
        }
      }
    }
    const previous = this.disabled;
    this.disabled = this.nextDisabled;
    this.nextDisabled = previous;
  }

  collect(): void {
    if (this.geometryRevision === this.world.geometryRevision && !this.controlsChanged) {
      return;
    }
    this.heads.fill(-1);
    this.edgeCount = 0;
    this.collectSweep(false);
    this.collectSweep(true);
    this.geometryRevision = this.world.geometryRevision;
    this.controlsChanged = false;
    this.revision += 1;
  }

  firstEdgeAt(index: number): number {
    return expectDefined(this.heads[index], "magic link edge head");
  }

  nextEdge(edge: number): number {
    return expectDefined(this.next[edge], "next magic link edge");
  }

  targetAt(edge: number): number {
    return expectDefined(this.targets[edge], "magic link target");
  }

  /** Two sparse row-major sweeps find nearest opposing targets without scanning each ray. */
  private collectSweep(reverse: boolean): void {
    const world = this.world;
    const horizontalFacing = reverse ? Direction.Left : Direction.Right;
    const verticalFacing = reverse ? Direction.Up : Direction.Down;
    this.columnTargets.fill(-1);
    let row = -1;
    let rowTarget = -1;
    for (
      let source = reverse
        ? world.lastFeatureIndex(WorldFeature.MagicLink)
        : world.firstFeatureIndex(WorldFeature.MagicLink);
      source >= 0;
      source = reverse
        ? world.previousFeatureIndex(WorldFeature.MagicLink, source)
        : world.nextFeatureIndex(WorldFeature.MagicLink, source)
    ) {
      const x = source % world.width;
      const y = (source - x) / world.width;
      if (row !== y) {
        row = y;
        rowTarget = -1;
      }
      const facing = world.orientationAtIndex(source);
      if (facing === horizontalFacing) {
        rowTarget = source;
      } else if (facing === verticalFacing) {
        this.columnTargets[x] = source;
      } else {
        const target = (facing & 1) !== 0
          ? rowTarget
          : expectDefined(this.columnTargets[x], "magic link column target");
        if (target >= 0 &&
            !this.disabled.has(world.idAtIndex(source)) &&
            !this.disabled.has(world.idAtIndex(target))) {
          // A directed ray adds an undirected edge, including nonreciprocal incoming links.
          this.addEdge(source, target);
          this.addEdge(target, source);
        }
      }
    }
  }

  private addEdge(source: number, target: number): void {
    if (this.edgeCount === this.targets.length) {
      const capacity = Math.max(8, this.edgeCount * 2);
      const targets = new Int32Array(capacity);
      const next = new Int32Array(capacity);
      targets.set(this.targets);
      next.set(this.next);
      this.targets = targets;
      this.next = next;
    }
    this.targets[this.edgeCount] = target;
    this.next[this.edgeCount] = this.firstEdgeAt(source);
    this.heads[source] = this.edgeCount++;
  }
}
