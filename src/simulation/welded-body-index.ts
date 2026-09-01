import { expectDefined } from "../util/assert";
import { TILE_DEFINITIONS, TileKind } from "./tile";
import type { World } from "./world";

/**
 * Retained welded-body topology and translation-only structural comparison.
 * Runtime tile state and stable IDs are intentionally not part of a match.
 */
export class WeldedBodyIndex {
  private readonly world: World;
  private readonly bodyRoots: Int32Array;
  private readonly bodyHeads: Int32Array;
  private readonly nextBodyMembers: Int32Array;
  private readonly bodyMinXs: Int32Array;
  private readonly bodyMinYs: Int32Array;
  private readonly bodyMemberCounts: Int32Array;

  constructor(world: World) {
    this.world = world;
    this.bodyRoots = new Int32Array(world.cellCount);
    this.bodyHeads = new Int32Array(world.cellCount);
    this.nextBodyMembers = new Int32Array(world.cellCount);
    this.bodyMinXs = new Int32Array(world.cellCount);
    this.bodyMinYs = new Int32Array(world.cellCount);
    this.bodyMemberCounts = new Int32Array(world.cellCount);
  }

  collect(): void {
    this.bodyRoots.fill(-1);
    this.bodyHeads.fill(-1);
    this.nextBodyMembers.fill(-1);
    this.bodyMemberCounts.fill(0);

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
      this.nextBodyMembers[index] = expectDefined(
        this.bodyHeads[root],
        "welded body member head",
      );
      this.bodyHeads[root] = index;

      const x = index % this.world.width;
      const y = (index - x) / this.world.width;
      const count = expectDefined(this.bodyMemberCounts[root], "welded body member count");
      if (count === 0) {
        this.bodyMinXs[root] = x;
        this.bodyMinYs[root] = y;
      } else {
        this.bodyMinXs[root] = Math.min(
          expectDefined(this.bodyMinXs[root], "welded body minimum x"),
          x,
        );
        this.bodyMinYs[root] = Math.min(
          expectDefined(this.bodyMinYs[root], "welded body minimum y"),
          y,
        );
      }
      this.bodyMemberCounts[root] = count + 1;
    }
  }

  rootAt(index: number): number {
    const root = expectDefined(this.bodyRoots[index], "welded body root");
    if (root < 0) {
      throw new Error(`Empty cell at index ${index} has no welded body`);
    }
    return root;
  }

  headAtRoot(root: number): number {
    const head = expectDefined(this.bodyHeads[root], "welded body head");
    if (head < 0) {
      throw new Error(`Index ${root} is not a welded body root`);
    }
    return head;
  }

  nextMember(index: number): number {
    return expectDefined(this.nextBodyMembers[index], "next welded body member");
  }

  matchesUnderTranslation(firstIndex: number, secondIndex: number): boolean {
    const firstRoot = this.rootAt(firstIndex);
    const secondRoot = this.rootAt(secondIndex);
    if (this.bodyMemberCounts[firstRoot] !== this.bodyMemberCounts[secondRoot]) {
      return false;
    }

    const offsetX = expectDefined(this.bodyMinXs[secondRoot], "second body minimum x") -
      expectDefined(this.bodyMinXs[firstRoot], "first body minimum x");
    const offsetY = expectDefined(this.bodyMinYs[secondRoot], "second body minimum y") -
      expectDefined(this.bodyMinYs[firstRoot], "first body minimum y");

    let firstMember = this.headAtRoot(firstRoot);
    while (firstMember >= 0) {
      const firstX = firstMember % this.world.width;
      const firstY = (firstMember - firstX) / this.world.width;
      const secondX = firstX + offsetX;
      const secondY = firstY + offsetY;
      if (
        secondX < 0 ||
        secondX >= this.world.width ||
        secondY < 0 ||
        secondY >= this.world.height
      ) {
        return false;
      }
      const secondMember = secondY * this.world.width + secondX;
      const firstKind = this.world.kindAtIndex(firstMember);
      const secondKind = this.world.kindAtIndex(secondMember);
      if (
        this.bodyRoots[secondMember] !== secondRoot ||
        firstKind !== secondKind ||
        (TILE_DEFINITIONS[firstKind].usesOrientation &&
          this.world.orientationAtIndex(firstMember) !==
            this.world.orientationAtIndex(secondMember)) ||
        this.world.hasRightWeldAtIndex(firstMember) !==
          this.world.hasRightWeldAtIndex(secondMember) ||
        this.world.hasDownWeldAtIndex(firstMember) !==
          this.world.hasDownWeldAtIndex(secondMember)
      ) {
        return false;
      }
      firstMember = this.nextMember(firstMember);
    }
    return true;
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
    while (expectDefined(this.bodyRoots[root], "welded body parent") !== root) {
      root = expectDefined(this.bodyRoots[root], "welded body parent");
    }
    while (index !== root) {
      const parent = expectDefined(this.bodyRoots[index], "welded body parent");
      this.bodyRoots[index] = root;
      index = parent;
    }
    return root;
  }
}
