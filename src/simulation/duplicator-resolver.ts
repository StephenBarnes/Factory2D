import { expectDefined } from "../util/assert";
import {
  Direction,
  oppositeDirection,
  TileKind,
} from "./tile";
import type { World } from "./world";
import { WeldedBodyIndex } from "./welded-body-index";

/**
 * Collects duplicator requests from one stable topology, jams overlapping
 * outputs, then commits every accepted body copy as one phase. Scratch buffers
 * are retained across ticks.
 */
export class DuplicatorResolver {
  private readonly world: World;
  private readonly bodies: WeldedBodyIndex;
  private readonly candidateDuplicators: Uint8Array;
  private readonly destinationOwners: Int32Array;
  private readonly sourceForDestination: Int32Array;
  private acceptedDestinationCount = 0;

  constructor(world: World, bodies: WeldedBodyIndex) {
    this.world = world;
    this.bodies = bodies;
    this.candidateDuplicators = new Uint8Array(world.cellCount);
    this.destinationOwners = new Int32Array(world.cellCount);
    this.sourceForDestination = new Int32Array(world.cellCount);
  }

  collect(): void {
    this.candidateDuplicators.fill(0);
    this.destinationOwners.fill(-1);
    this.sourceForDestination.fill(-1);
    this.acceptedDestinationCount = 0;

    for (let duplicator = 0; duplicator < this.world.cellCount; duplicator += 1) {
      if (!this.isPoweredDuplicator(duplicator)) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(duplicator);
      const source = this.neighborIndex(duplicator, oppositeDirection(orientation));
      if (source < 0 || this.world.kindAtIndex(source) === TileKind.Empty) {
        continue;
      }
      const sourceRoot = this.bodies.rootAt(source);
      if (this.bodyFits(sourceRoot, duplicator, orientation)) {
        this.candidateDuplicators[duplicator] = 1;
      }
    }

    for (let duplicator = 0; duplicator < this.world.cellCount; duplicator += 1) {
      if (this.candidateDuplicators[duplicator] !== 1) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(duplicator);
      const source = this.neighborIndex(duplicator, oppositeDirection(orientation));
      const sourceRoot = this.bodies.rootAt(source);
      let member = this.bodies.headAtRoot(sourceRoot);
      while (member >= 0) {
        const destination = this.destinationIndex(member, duplicator, orientation);
        const owner = expectDefined(this.destinationOwners[destination], "duplicator output owner");
        this.destinationOwners[destination] = owner === -1 || owner === duplicator
          ? duplicator
          : -2;
        member = this.bodies.nextMember(member);
      }
    }

    for (let duplicator = 0; duplicator < this.world.cellCount; duplicator += 1) {
      if (this.candidateDuplicators[duplicator] !== 1) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(duplicator);
      const source = this.neighborIndex(duplicator, oppositeDirection(orientation));
      const sourceRoot = this.bodies.rootAt(source);
      let accepted = true;
      let member = this.bodies.headAtRoot(sourceRoot);
      while (member >= 0) {
        const destination = this.destinationIndex(member, duplicator, orientation);
        if (this.destinationOwners[destination] !== duplicator) {
          accepted = false;
        }
        member = this.bodies.nextMember(member);
      }
      if (!accepted) {
        continue;
      }
      member = this.bodies.headAtRoot(sourceRoot);
      while (member >= 0) {
        const destination = this.destinationIndex(member, duplicator, orientation);
        this.sourceForDestination[destination] = member;
        this.acceptedDestinationCount += 1;
        member = this.bodies.nextMember(member);
      }
    }
  }

  commit(interpolationSource?: World): void {
    if (this.acceptedDestinationCount === 0) {
      return;
    }
    interpolationSource?.applyDuplications(
      this.sourceForDestination,
      this.destinationOwners,
    );
    this.world.applyDuplications(this.sourceForDestination, this.destinationOwners);
  }

  private isPoweredDuplicator(index: number): boolean {
    if (this.world.kindAtIndex(index) !== TileKind.Duplicator) {
      return false;
    }
    const orientation = this.world.orientationAtIndex(index);
    const left = ((orientation + Direction.Left) & 3) as Direction;
    const right = ((orientation + Direction.Right) & 3) as Direction;
    return this.world.chargeAtPortIndex(index, left) === 1 ||
      this.world.chargeAtPortIndex(index, right) === 1;
  }

  private bodyFits(root: number, duplicator: number, orientation: Direction): boolean {
    let member = this.bodies.headAtRoot(root);
    while (member >= 0) {
      const destination = this.destinationIndex(member, duplicator, orientation);
      if (destination < 0 || this.world.kindAtIndex(destination) !== TileKind.Empty) {
        return false;
      }
      member = this.bodies.nextMember(member);
    }
    return true;
  }

  private destinationIndex(
    source: number,
    duplicator: number,
    orientation: Direction,
  ): number {
    const sourceX = source % this.world.width;
    const sourceY = (source - sourceX) / this.world.width;
    const duplicatorX = duplicator % this.world.width;
    const duplicatorY = (duplicator - duplicatorX) / this.world.width;
    const destinationX = orientation === Direction.Left || orientation === Direction.Right
      ? duplicatorX * 2 - sourceX
      : sourceX;
    const destinationY = orientation === Direction.Up || orientation === Direction.Down
      ? duplicatorY * 2 - sourceY
      : sourceY;
    return destinationX >= 0 &&
        destinationX < this.world.width &&
        destinationY >= 0 &&
        destinationY < this.world.height
      ? destinationY * this.world.width + destinationX
      : -1;
  }


  private neighborIndex(index: number, direction: Direction): number {
    const x = index % this.world.width;
    switch (direction) {
      case Direction.Up:
        return index >= this.world.width ? index - this.world.width : -1;
      case Direction.Right:
        return x < this.world.width - 1 ? index + 1 : -1;
      case Direction.Down:
        return index < this.world.cellCount - this.world.width
          ? index + this.world.width
          : -1;
      case Direction.Left:
        return x > 0 ? index - 1 : -1;
      default:
        throw new RangeError(`Invalid direction ${direction as number}`);
    }
  }
}
