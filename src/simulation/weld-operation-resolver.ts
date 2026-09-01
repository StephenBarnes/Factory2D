import { expectDefined } from "../util/assert";
import {
  Direction,
  directionX,
  directionY,
  TileKind,
} from "./tile";
import type { World } from "./world";

const enum EdgeIntent {
  None = 0,
  Split = -1,
  Weld = 1,
  Conflict = 2,
}

/**
 * Collects welder and splitter requests from one stable topology, rejects
 * opposing requests for the same edge, then commits every accepted edge as one
 * phase. Scratch buffers are retained across ticks.
 */
export class WeldOperationResolver {
  readonly successfulOperationIndices: Uint8Array;

  private readonly world: World;
  private readonly edgeIntents: Int8Array;
  private readonly changedEdges: Uint8Array;
  private readonly operatorRequests: Int32Array;

  constructor(world: World) {
    this.world = world;
    this.edgeIntents = new Int8Array(world.cellCount * 2);
    this.changedEdges = new Uint8Array(world.cellCount * 2);
    this.operatorRequests = new Int32Array(world.cellCount * 2);
    this.successfulOperationIndices = new Uint8Array(world.cellCount);
  }

  collect(): void {
    this.edgeIntents.fill(EdgeIntent.None);
    this.changedEdges.fill(0);
    this.operatorRequests.fill(-1);
    this.successfulOperationIndices.fill(0);

    for (let index = 0; index < this.world.cellCount; index += 1) {
      const kind = this.world.kindAtIndex(index);
      if (kind !== TileKind.Welder && kind !== TileKind.Splitter) {
        continue;
      }

      const orientation = this.world.orientationAtIndex(index);
      const leftSide = ((orientation + Direction.Left) & 3) as Direction;
      if (this.world.chargeAtPortIndex(index, leftSide) === -1) {
        continue;
      }

      const target = this.neighborIndex(index, orientation);
      if (target < 0 || this.world.kindAtIndex(target) === TileKind.Empty) {
        continue;
      }

      const intent = kind === TileKind.Welder ? EdgeIntent.Weld : EdgeIntent.Split;
      const firstSide = ((orientation + Direction.Right) & 3) as Direction;
      const secondSide = ((orientation + Direction.Left) & 3) as Direction;
      this.requestEdge(index, 0, target, firstSide, intent);
      this.requestEdge(index, 1, target, secondSide, intent);
    }

    for (let edge = 0; edge < this.edgeIntents.length; edge += 1) {
      const intent = expectDefined(this.edgeIntents[edge], "weld operation edge intent");
      if (intent !== EdgeIntent.Weld && intent !== EdgeIntent.Split) {
        continue;
      }
      const { firstX, firstY, secondX, secondY } = this.edgeCoordinates(edge);
      const welded = this.world.isWelded(firstX, firstY, secondX, secondY);
      if (
        (intent === EdgeIntent.Weld &&
          !welded &&
          this.world.canWeld(firstX, firstY, secondX, secondY)) ||
        (intent === EdgeIntent.Split && welded)
      ) {
        this.changedEdges[edge] = 1;
      }
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      const firstRequest = expectDefined(
        this.operatorRequests[index * 2],
        "first weld operation request",
      );
      const secondRequest = expectDefined(
        this.operatorRequests[index * 2 + 1],
        "second weld operation request",
      );
      if (
        (firstRequest >= 0 && this.changedEdges[firstRequest] === 1) ||
        (secondRequest >= 0 && this.changedEdges[secondRequest] === 1)
      ) {
        this.successfulOperationIndices[index] = 1;
      }
    }
  }

  commit(): void {
    for (let edge = 0; edge < this.edgeIntents.length; edge += 1) {
      if (this.changedEdges[edge] !== 1) {
        continue;
      }
      const intent = expectDefined(this.edgeIntents[edge], "committed weld operation intent");
      if (intent !== EdgeIntent.Weld && intent !== EdgeIntent.Split) {
        throw new Error(`Changed weld edge ${edge} has invalid intent ${intent}`);
      }
      const { firstX, firstY, secondX, secondY } = this.edgeCoordinates(edge);
      if (!this.world.setWeld(
        firstX,
        firstY,
        secondX,
        secondY,
        intent === EdgeIntent.Weld,
      )) {
        throw new Error(`Accepted weld operation for edge ${edge} could not be committed`);
      }
    }
  }

  private requestEdge(
    operatorIndex: number,
    requestOffset: 0 | 1,
    targetIndex: number,
    direction: Direction,
    intent: EdgeIntent.Weld | EdgeIntent.Split,
  ): void {
    const neighbor = this.neighborIndex(targetIndex, direction);
    if (neighbor < 0) {
      return;
    }
    const edge = this.edgeIndex(targetIndex, neighbor);
    this.operatorRequests[operatorIndex * 2 + requestOffset] = edge;
    const existing = expectDefined(this.edgeIntents[edge], "existing weld operation intent");
    if (existing === EdgeIntent.None) {
      this.edgeIntents[edge] = intent;
    } else if (existing !== intent) {
      this.edgeIntents[edge] = EdgeIntent.Conflict;
    }
  }

  private edgeIndex(first: number, second: number): number {
    const difference = second - first;
    if (difference === 1 || difference === -1) {
      return Math.min(first, second) * 2;
    }
    if (difference === this.world.width || difference === -this.world.width) {
      return Math.min(first, second) * 2 + 1;
    }
    throw new RangeError("A weld operation requires orthogonally adjacent cells");
  }

  private edgeCoordinates(edge: number): {
    readonly firstX: number;
    readonly firstY: number;
    readonly secondX: number;
    readonly secondY: number;
  } {
    const first = edge >> 1;
    const firstX = first % this.world.width;
    const firstY = (first - firstX) / this.world.width;
    return (edge & 1) === 0
      ? { firstX, firstY, secondX: firstX + 1, secondY: firstY }
      : { firstX, firstY, secondX: firstX, secondY: firstY + 1 };
  }

  private neighborIndex(index: number, direction: Direction): number {
    const x = index % this.world.width;
    const y = (index - x) / this.world.width;
    const neighborX = x + directionX(direction);
    const neighborY = y + directionY(direction);
    return neighborX < 0 ||
        neighborX >= this.world.width ||
        neighborY < 0 ||
        neighborY >= this.world.height
      ? -1
      : neighborY * this.world.width + neighborX;
  }
}
