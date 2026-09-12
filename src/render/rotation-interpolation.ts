import {
  rotationAnimationFor,
  type RotationAnimationCell,
} from "../simulation/rotation-animation";
import type { World } from "../simulation/world";
import { WorldFeature } from "../simulation/world-features";

/** Canvas transform in grid units, applied to the committed body geometry. */
export interface RotationTransform {
  cosine: number;
  sine: number;
  x: number;
  y: number;
  quarterTurn: -1 | 1;
}

/** Reuses identity lookups and a borrowed transform; never rebuilds body paths per frame. */
export class RotationInterpolation {
  readonly indices: number[] = [];
  private readonly previousIndices = new Map<number, number>();
  private records: ReadonlyMap<number, RotationAnimationCell> | null = null;
  private world: World | null = null;
  private previous: World | null = null;
  private worldRevision = -1;
  private previousRevision = -1;
  private progress = 1;
  private cosine = 1;
  private sine = 0;
  private readonly transform: RotationTransform = {
    cosine: 1, sine: 0, x: 0, y: 0, quarterTurn: 1,
  };

  prepare(world: World, previous: World | null, progress: number): void {
    this.records = progress < 1 ? rotationAnimationFor(world, previous) : null;
    this.progress = progress;
    if (this.records === null || previous === null) return;
    if (this.previous !== previous || this.previousRevision !== previous.revision) {
      this.previousIndices.clear();
      for (let index = previous.firstFeatureIndex(WorldFeature.Occupied); index >= 0;
        index = previous.nextFeatureIndex(WorldFeature.Occupied, index)) {
        this.previousIndices.set(previous.idAtIndex(index), index);
      }
    }
    if (this.world !== world || this.worldRevision !== world.revision ||
      this.previous !== previous || this.previousRevision !== previous.revision) {
      this.indices.length = 0;
      for (let index = world.firstFeatureIndex(WorldFeature.Occupied); index >= 0;
        index = world.nextFeatureIndex(WorldFeature.Occupied, index)) {
        const id = world.idAtIndex(index);
        if (this.records.has(id) && this.previousIndices.has(id)) this.indices.push(index);
      }
    }
    this.world = world;
    this.previous = previous;
    this.worldRevision = world.revision;
    this.previousRevision = previous.revision;
    const angle = (1 - progress) * Math.PI / 2;
    this.cosine = Math.cos(angle);
    this.sine = Math.sin(angle);
  }

  get active(): boolean {
    return this.records !== null;
  }

  /** The returned object is reused by the next call. Missing/new IDs render committed. */
  at(index: number): RotationTransform | null {
    const world = this.world;
    if (this.records === null || world === null) return null;
    const id = world.idAtIndex(index);
    const rotation = this.records.get(id);
    const previousIndex = this.previousIndices.get(id);
    if (rotation === undefined || previousIndex === undefined) return null;
    const { pivotX, pivotY, sourceX, sourceY, quarterTurn } = rotation;
    const finalX = index % world.width;
    const finalY = Math.floor(index / world.width);
    const previousX = previousIndex % world.width;
    const previousY = Math.floor(previousIndex / world.width);
    const dx = sourceX - pivotX;
    const dy = sourceY - pivotY;
    const destinationX = pivotX - quarterTurn * dy;
    const destinationY = pivotY + quarterTurn * dx;
    const remaining = 1 - this.progress;
    // Forward angle is complementary to the remaining inverse quarter-turn.
    const forwardCosine = this.sine;
    const forwardSine = quarterTurn * this.cosine;
    const centerX = pivotX + 0.5 + forwardCosine * dx - forwardSine * dy +
      (previousX - sourceX) * remaining + (finalX - destinationX) * this.progress;
    const centerY = pivotY + 0.5 + forwardSine * dx + forwardCosine * dy +
      (previousY - sourceY) * remaining + (finalY - destinationY) * this.progress;
    const sine = -quarterTurn * this.sine;
    const transform = this.transform;
    transform.cosine = this.cosine;
    transform.sine = sine;
    transform.x = centerX - this.cosine * (finalX + 0.5) + sine * (finalY + 0.5);
    transform.y = centerY - sine * (finalX + 0.5) - this.cosine * (finalY + 0.5);
    transform.quarterTurn = quarterTurn;
    return transform;
  }
}
