import { directionX, directionY, TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";
import { WorldFeature } from "../simulation/world-features";

/** Snapshot-local identity correspondence; all offsets are in grid units. */
export class TranslationInterpolation {
  readonly movingIndices: number[] = [];
  revision = 0;
  private readonly previousIndices = new Map<number, number>();
  private previous: World | null = null;
  private previousRevision = -1;
  private world: World | null = null;
  private worldRevision = -1;
  private horizontal = new Int32Array(0);
  private vertical = new Int32Array(0);
  private transitions = new Int8Array(0);

  prepare(world: World, previous: World | null): void {
    const previousRevision = previous?.revision ?? -1;
    const previousChanged = this.previous !== previous || this.previousRevision !== previousRevision;
    if (!previousChanged && this.world === world && this.worldRevision === world.revision) return;
    if (previousChanged) {
      this.previousIndices.clear();
      if (previous !== null) {
        for (let index = previous.firstFeatureIndex(WorldFeature.Occupied); index >= 0;
          index = previous.nextFeatureIndex(WorldFeature.Occupied, index)) {
          this.previousIndices.set(previous.idAtIndex(index), index);
        }
      }
    }
    this.previous = previous;
    this.previousRevision = previousRevision;
    this.world = world;
    this.worldRevision = world.revision;
    this.revision += 1;
    this.movingIndices.length = 0;
    if (this.horizontal.length !== world.cellCount) {
      this.horizontal = new Int32Array(world.cellCount);
      this.vertical = new Int32Array(world.cellCount);
      this.transitions = new Int8Array(world.cellCount);
    } else {
      this.horizontal.fill(0);
      this.vertical.fill(0);
      this.transitions.fill(0);
    }
    if (previous === null) return;

    for (let index = world.firstFeatureIndex(WorldFeature.Occupied); index >= 0;
      index = world.nextFeatureIndex(WorldFeature.Occupied, index)) {
      const kind = world.kindAtIndex(index);
      let previousIndex = this.previousIndices.get(world.idAtIndex(index));
      if (kind === TileKind.PistonBase && previousIndex === undefined) {
        // Extension gives the base a fresh ID; the adjacent head retains the old P ID.
        const orientation = world.orientationAtIndex(index);
        const armX = index % world.width + directionX(orientation);
        const armY = Math.floor(index / world.width) + directionY(orientation);
        if (armX >= 0 && armX < world.width && armY >= 0 && armY < world.height &&
          world.kindAt(armX, armY) === TileKind.PistonArm &&
          world.orientationAt(armX, armY) === orientation) {
          const armPrevious = this.previousIndices.get(world.idAt(armX, armY));
          if (armPrevious !== undefined && previous.kindAtIndex(armPrevious) === TileKind.Piston) {
            previousIndex = armPrevious;
            this.transitions[index] = 1;
          }
        }
      }
      if (previousIndex === undefined) continue;
      const previousKind = previous.kindAtIndex(previousIndex);
      let previousX = previousIndex % previous.width;
      let previousY = Math.floor(previousIndex / previous.width);
      if (kind === TileKind.PistonArm && previousKind === TileKind.Piston) {
        this.transitions[index] = 1;
      } else if (kind === TileKind.Piston && previousKind === TileKind.PistonArm) {
        this.transitions[index] = -1;
        // The combined tile's housing follows the old base; its glyph retracts the head.
        const orientation = previous.orientationAtIndex(previousIndex);
        previousX -= directionX(orientation);
        previousY -= directionY(orientation);
      }
      const dx = previousX - index % world.width;
      const dy = previousY - Math.floor(index / world.width);
      this.horizontal[index] = dx;
      this.vertical[index] = dy;
      if (dx !== 0 || dy !== 0 || this.transitions[index] !== 0) this.movingIndices.push(index);
    }
  }

  xAt(index: number): number {
    return this.horizontal[index] ?? 0;
  }

  yAt(index: number): number {
    return this.vertical[index] ?? 0;
  }

  transitionAt(index: number): -1 | 0 | 1 {
    return (this.transitions[index] ?? 0) as -1 | 0 | 1;
  }
}
