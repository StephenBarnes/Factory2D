import {
  rotationAnimationFor,
  type RotationAnimationCell,
} from "../simulation/rotation-animation";
import { directionX, directionY, TileKind } from "../simulation/tile";
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

interface RenderRotation extends RotationAnimationCell {
  readonly previousX: number;
  readonly previousY: number;
  readonly destinationX: number;
  readonly destinationY: number;
  readonly group: number;
}

/** Reuses identity lookups and a borrowed transform; never rebuilds body paths per frame. */
export class RotationInterpolation {
  readonly indices: number[] = [];
  revision = 0;
  private readonly previousIndices = new Map<number, number>();
  private readonly cells = new Map<number, RenderRotation>();
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
    const records = progress < 1 ? rotationAnimationFor(world, previous) : null;
    const recordsChanged = records !== this.records;
    this.records = records;
    if (recordsChanged) this.revision += 1;
    this.progress = progress;
    if (records === null || previous === null) return;
    if (this.previous !== previous || this.previousRevision !== previous.revision) {
      this.previousIndices.clear();
      for (let index = previous.firstFeatureIndex(WorldFeature.Occupied); index >= 0;
        index = previous.nextFeatureIndex(WorldFeature.Occupied, index)) {
        this.previousIndices.set(previous.idAtIndex(index), index);
      }
    }
    if (recordsChanged || this.world !== world || this.worldRevision !== world.revision ||
      this.previous !== previous || this.previousRevision !== previous.revision) {
      this.indices.length = 0;
      this.cells.clear();
      const groups = new Map<string, number>();
      for (let index = world.firstFeatureIndex(WorldFeature.Occupied); index >= 0;
        index = world.nextFeatureIndex(WorldFeature.Occupied, index)) {
        let id = world.idAtIndex(index);
        const kind = world.kindAtIndex(index);
        if (kind === TileKind.PistonBase && !this.previousIndices.has(id)) {
          const orientation = world.orientationAtIndex(index);
          const armX = index % world.width + directionX(orientation);
          const armY = Math.floor(index / world.width) + directionY(orientation);
          if (armX >= 0 && armX < world.width && armY >= 0 && armY < world.height &&
            world.kindAt(armX, armY) === TileKind.PistonArm &&
            world.orientationAt(armX, armY) === orientation) {
            const armId = world.idAt(armX, armY);
            const armPrevious = this.previousIndices.get(armId);
            if (armPrevious !== undefined && previous.kindAtIndex(armPrevious) === TileKind.Piston) {
              id = armId;
            }
          }
        }
        const rotation = records.get(id);
        const previousIndex = this.previousIndices.get(id);
        if (rotation === undefined || previousIndex === undefined) continue;
        const { pivotX, pivotY, quarterTurn } = rotation;
        let { sourceX, sourceY } = rotation;
        let previousX = previousIndex % previous.width;
        let previousY = Math.floor(previousIndex / previous.width);
        if (kind === TileKind.Piston && previous.kindAtIndex(previousIndex) === TileKind.PistonArm) {
          // Rotation carries the housing anchor; the combined glyph retracts its head.
          const orientation = previous.orientationAtIndex(previousIndex);
          sourceX -= directionX(orientation);
          sourceY -= directionY(orientation);
          previousX -= directionX(orientation);
          previousY -= directionY(orientation);
        }
        const destinationX = pivotX - quarterTurn * (sourceY - pivotY);
        const destinationY = pivotY + quarterTurn * (sourceX - pivotX);
        const finalX = index % world.width;
        const finalY = Math.floor(index / world.width);
        // Equal pivot, turn, and pre/post translations describe one rigid transform
        // at every progress, even when a piston deforms a larger welded assembly.
        const key = `${pivotX},${pivotY},${quarterTurn},${previousX - sourceX},${previousY - sourceY},${finalX - destinationX},${finalY - destinationY}`;
        let group = groups.get(key);
        if (group === undefined) {
          group = groups.size + 1;
          groups.set(key, group);
        }
        this.cells.set(index, {
          pivotX, pivotY, quarterTurn, sourceX, sourceY,
          previousX, previousY, destinationX, destinationY, group,
        });
        this.indices.push(index);
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

  groupAt(index: number): number {
    return this.records === null ? 0 : this.cells.get(index)?.group ?? 0;
  }

  /** The returned object is reused by the next call. Missing/new IDs render committed. */
  at(index: number): RotationTransform | null {
    const world = this.world;
    if (this.records === null || world === null) return null;
    const rotation = this.cells.get(index);
    if (rotation === undefined) return null;
    const {
      pivotX, pivotY, sourceX, sourceY, quarterTurn,
      previousX, previousY, destinationX, destinationY,
    } = rotation;
    const finalX = index % world.width;
    const finalY = Math.floor(index / world.width);
    const dx = sourceX - pivotX;
    const dy = sourceY - pivotY;
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
