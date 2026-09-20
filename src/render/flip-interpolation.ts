import { flipAnimationFor, type FlipAnimationCell } from "../simulation/flip-animation";
import { rotationAnimationFor } from "../simulation/rotation-animation";
import { directionX, directionY, TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";
import { WorldFeature } from "../simulation/world-features";

/** Affine canvas transform in grid units, applied to committed body paths. */
export interface FlipTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  x: number;
  y: number;
  horizontally: boolean;
  priorQuarterTurn: -1 | 0 | 1;
}

interface RenderFlip extends FlipAnimationCell {
  readonly previousOffsetX: number;
  readonly previousOffsetY: number;
  readonly destinationX: number;
  readonly destinationY: number;
  readonly rotationPivotX: number;
  readonly rotationPivotY: number;
  readonly priorQuarterTurn: -1 | 0 | 1;
  readonly group: number;
}

/** A reflection squeezes through its pivot; cached geometry is never rebuilt per frame. */
export class FlipInterpolation {
  readonly indices: number[] = [];
  revision = 0;
  private readonly previousIndices = new Map<number, number>();
  private readonly cells = new Map<number, RenderFlip>();
  private records: ReadonlyMap<number, FlipAnimationCell> | null = null;
  private world: World | null = null;
  private previous: World | null = null;
  private worldRevision = -1;
  private previousRevision = -1;
  private progress = 1;
  private scale = 1;
  private cosine = 1;
  private sine = 0;
  private readonly transform: FlipTransform = {
    a: 1, b: 0, c: 0, d: 1, x: 0, y: 0, horizontally: true, priorQuarterTurn: 0,
  };

  prepare(world: World, previous: World | null, progress: number): void {
    const records = progress < 1 ? flipAnimationFor(world, previous) : null;
    const recordsChanged = records !== this.records;
    this.records = records;
    this.progress = progress;
    if (recordsChanged) this.revision += 1;
    if (records === null || previous === null) return;
    const previousChanged = this.previous !== previous || this.previousRevision !== previous.revision;
    if (previousChanged) {
      this.previousIndices.clear();
      for (let index = previous.firstFeatureIndex(WorldFeature.Occupied); index >= 0;
        index = previous.nextFeatureIndex(WorldFeature.Occupied, index)) {
        this.previousIndices.set(previous.idAtIndex(index), index);
      }
    }
    if (recordsChanged || this.world !== world || this.worldRevision !== world.revision || previousChanged) {
      this.revision += 1;
      this.indices.length = 0;
      this.cells.clear();
      const rotations = rotationAnimationFor(world, previous);
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
            if (armPrevious !== undefined && previous.kindAtIndex(armPrevious) === TileKind.Piston) id = armId;
          }
        }
        const flip = records.get(id);
        const previousIndex = this.previousIndices.get(id);
        if (flip === undefined || previousIndex === undefined) continue;
        const rotation = rotations?.get(id);
        let { sourceX, sourceY } = flip;
        let previousX = previousIndex % previous.width;
        let previousY = Math.floor(previousIndex / previous.width);
        let beforeRotationX = rotation?.sourceX ?? sourceX;
        let beforeRotationY = rotation?.sourceY ?? sourceY;
        if (kind === TileKind.Piston && previous.kindAtIndex(previousIndex) === TileKind.PistonArm) {
          // The surviving arm identity now draws a housing-anchored combined glyph.
          sourceX -= directionX(flip.sourceOrientation);
          sourceY -= directionY(flip.sourceOrientation);
          const orientation = previous.orientationAtIndex(previousIndex);
          previousX -= directionX(orientation);
          previousY -= directionY(orientation);
          beforeRotationX -= directionX(rotation === undefined ? flip.sourceOrientation : orientation);
          beforeRotationY -= directionY(rotation === undefined ? flip.sourceOrientation : orientation);
        }
        const { pivotX, pivotY, horizontally } = flip;
        const destinationX = horizontally ? 2 * pivotX - sourceX : sourceX;
        const destinationY = horizontally ? sourceY : 2 * pivotY - sourceY;
        const previousOffsetX = previousX - beforeRotationX;
        const previousOffsetY = previousY - beforeRotationY;
        const rotationPivotX = rotation?.pivotX ?? pivotX;
        const rotationPivotY = rotation?.pivotY ?? pivotY;
        const priorQuarterTurn = rotation?.quarterTurn ?? 0;
        const finalX = index % world.width;
        const finalY = Math.floor(index / world.width);
        const key = `${pivotX},${pivotY},${horizontally},${rotationPivotX},${rotationPivotY},${priorQuarterTurn},${previousOffsetX},${previousOffsetY},${finalX - destinationX},${finalY - destinationY}`;
        let group = groups.get(key);
        if (group === undefined) {
          group = groups.size + 1;
          groups.set(key, group);
        }
        this.cells.set(index, {
          ...flip, sourceX, sourceY, previousOffsetX, previousOffsetY,
          destinationX, destinationY, rotationPivotX, rotationPivotY, priorQuarterTurn, group,
        });
        this.indices.push(index);
      }
    }
    this.world = world;
    this.previous = previous;
    this.worldRevision = world.revision;
    this.previousRevision = previous.revision;
    this.scale = progress === 0.5 ? 0 : -Math.cos(progress * Math.PI);
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

  /** Borrowed until the next call. Reflection takes priority over the earlier turn. */
  at(index: number): FlipTransform | null {
    if (this.records === null || this.world === null) return null;
    const flip = this.cells.get(index);
    if (flip === undefined) return null;
    const { pivotX, pivotY, horizontally, sourceX, sourceY, priorQuarterTurn } = flip;
    const finalX = index % this.world.width;
    const finalY = Math.floor(index / this.world.width);
    const sx = horizontally ? this.scale : 1;
    const sy = horizontally ? 1 : this.scale;
    const cosine = priorQuarterTurn === 0 ? 1 : this.cosine;
    const sine = -priorQuarterTurn * this.sine;
    // First interpolate the reflection, then unwind any earlier turn. At zero this
    // is the exact inverse of F*R; at one it is identity, including artwork frames.
    const reflectedX = pivotX + 0.5 + (horizontally ? -sx : sx) * (sourceX - pivotX);
    const reflectedY = pivotY + 0.5 + (horizontally ? sy : -sy) * (sourceY - pivotY);
    const rotationX = flip.rotationPivotX + 0.5;
    const rotationY = flip.rotationPivotY + 0.5;
    const remaining = 1 - this.progress;
    const centerX = rotationX + cosine * (reflectedX - rotationX) - sine * (reflectedY - rotationY) +
      flip.previousOffsetX * remaining + (finalX - flip.destinationX) * this.progress;
    const centerY = rotationY + sine * (reflectedX - rotationX) + cosine * (reflectedY - rotationY) +
      flip.previousOffsetY * remaining + (finalY - flip.destinationY) * this.progress;
    const transform = this.transform;
    transform.a = cosine * sx;
    transform.b = sine * sx;
    transform.c = -sine * sy;
    transform.d = cosine * sy;
    transform.x = centerX - transform.a * (finalX + 0.5) - transform.c * (finalY + 0.5);
    transform.y = centerY - transform.b * (finalX + 0.5) - transform.d * (finalY + 0.5);
    transform.horizontally = horizontally;
    transform.priorQuarterTurn = priorQuarterTurn;
    return transform;
  }
}
