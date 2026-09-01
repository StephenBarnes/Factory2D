import { expectDefined } from "../util/assert";
import {
  Direction,
  directionX,
  directionY,
  oppositeDirection,
  TileKind,
} from "./tile";
import type { World } from "./world";

/**
 * Collects duplicator requests from one stable topology, jams overlapping
 * outputs, then commits every accepted body copy as one phase. Scratch buffers
 * are retained across ticks.
 */
export class DuplicatorResolver {
  private readonly world: World;
  private readonly bodyRoots: Int32Array;
  private readonly bodyHeads: Int32Array;
  private readonly nextBodyMember: Int32Array;
  private readonly candidateDuplicators: Uint8Array;
  private readonly destinationOwners: Int32Array;
  private readonly sourceForDestination: Int32Array;

  constructor(world: World) {
    this.world = world;
    this.bodyRoots = new Int32Array(world.cellCount);
    this.bodyHeads = new Int32Array(world.cellCount);
    this.nextBodyMember = new Int32Array(world.cellCount);
    this.candidateDuplicators = new Uint8Array(world.cellCount);
    this.destinationOwners = new Int32Array(world.cellCount);
    this.sourceForDestination = new Int32Array(world.cellCount);
  }

  collect(): void {
    this.collectWeldedBodies();
    this.candidateDuplicators.fill(0);
    this.destinationOwners.fill(-1);
    this.sourceForDestination.fill(-1);

    for (let duplicator = 0; duplicator < this.world.cellCount; duplicator += 1) {
      if (!this.isPoweredDuplicator(duplicator)) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(duplicator);
      const source = this.neighborIndex(duplicator, oppositeDirection(orientation));
      if (source < 0 || this.world.kindAtIndex(source) === TileKind.Empty) {
        continue;
      }
      const sourceRoot = expectDefined(this.bodyRoots[source], "duplicator source body root");
      if (this.bodyFits(sourceRoot, orientation)) {
        this.candidateDuplicators[duplicator] = 1;
      }
    }

    for (let duplicator = 0; duplicator < this.world.cellCount; duplicator += 1) {
      if (this.candidateDuplicators[duplicator] !== 1) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(duplicator);
      const source = this.neighborIndex(duplicator, oppositeDirection(orientation));
      const sourceRoot = expectDefined(this.bodyRoots[source], "candidate source body root");
      let member = expectDefined(this.bodyHeads[sourceRoot], "candidate body member head");
      while (member >= 0) {
        const destination = this.destinationIndex(member, orientation);
        const owner = expectDefined(this.destinationOwners[destination], "duplicator output owner");
        this.destinationOwners[destination] = owner === -1 || owner === duplicator
          ? duplicator
          : -2;
        member = expectDefined(this.nextBodyMember[member], "next candidate body member");
      }
    }

    for (let duplicator = 0; duplicator < this.world.cellCount; duplicator += 1) {
      if (this.candidateDuplicators[duplicator] !== 1) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(duplicator);
      const source = this.neighborIndex(duplicator, oppositeDirection(orientation));
      const sourceRoot = expectDefined(this.bodyRoots[source], "accepted source body root");
      let accepted = true;
      let member = expectDefined(this.bodyHeads[sourceRoot], "accepted body member head");
      while (member >= 0) {
        const destination = this.destinationIndex(member, orientation);
        if (this.destinationOwners[destination] !== duplicator) {
          accepted = false;
        }
        member = expectDefined(this.nextBodyMember[member], "next accepted body member");
      }
      if (!accepted) {
        continue;
      }
      member = expectDefined(this.bodyHeads[sourceRoot], "committed body member head");
      while (member >= 0) {
        const destination = this.destinationIndex(member, orientation);
        this.sourceForDestination[destination] = member;
        member = expectDefined(this.nextBodyMember[member], "next committed body member");
      }
    }
  }

  commit(): void {
    this.world.applyDuplications(this.sourceForDestination);
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

  private bodyFits(root: number, orientation: Direction): boolean {
    let member = expectDefined(this.bodyHeads[root], "fitted body member head");
    while (member >= 0) {
      const destination = this.destinationIndex(member, orientation);
      if (destination < 0 || this.world.kindAtIndex(destination) !== TileKind.Empty) {
        return false;
      }
      member = expectDefined(this.nextBodyMember[member], "next fitted body member");
    }
    return true;
  }

  private destinationIndex(source: number, orientation: Direction): number {
    const sourceX = source % this.world.width;
    const sourceY = (source - sourceX) / this.world.width;
    const destinationX = sourceX + directionX(orientation) * 2;
    const destinationY = sourceY + directionY(orientation) * 2;
    return destinationX >= 0 &&
        destinationX < this.world.width &&
        destinationY >= 0 &&
        destinationY < this.world.height
      ? destinationY * this.world.width + destinationX
      : -1;
  }

  private collectWeldedBodies(): void {
    this.bodyRoots.fill(-1);
    this.bodyHeads.fill(-1);
    this.nextBodyMember.fill(-1);
    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (this.world.kindAtIndex(index) !== TileKind.Empty) {
        this.bodyRoots[index] = index;
      }
    }
    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (this.bodyRoots[index] === -1) {
        continue;
      }
      if (this.world.hasRightWeldAtIndex(index)) {
        this.unionBodies(index, index + 1);
      }
      if (this.world.hasDownWeldAtIndex(index)) {
        this.unionBodies(index, index + this.world.width);
      }
    }
    for (let index = this.world.cellCount - 1; index >= 0; index -= 1) {
      if (this.bodyRoots[index] === -1) {
        continue;
      }
      const root = this.findBodyRoot(index);
      this.bodyRoots[index] = root;
      this.nextBodyMember[index] = expectDefined(this.bodyHeads[root], "duplicator body head");
      this.bodyHeads[root] = index;
    }
  }


  private unionBodies(first: number, second: number): void {
    const firstRoot = this.findBodyRoot(first);
    const secondRoot = this.findBodyRoot(second);
    if (firstRoot === secondRoot) {
      return;
    }
    if (firstRoot < secondRoot) {
      this.bodyRoots[secondRoot] = firstRoot;
    } else {
      this.bodyRoots[firstRoot] = secondRoot;
    }
  }

  private findBodyRoot(index: number): number {
    let root = index;
    while (expectDefined(this.bodyRoots[root], "duplicator body parent") !== root) {
      root = expectDefined(this.bodyRoots[root], "duplicator body parent");
    }
    while (index !== root) {
      const parent = expectDefined(this.bodyRoots[index], "duplicator body parent");
      this.bodyRoots[index] = root;
      index = parent;
    }
    return root;
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
