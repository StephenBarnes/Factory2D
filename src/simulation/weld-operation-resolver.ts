import { expectDefined } from "../util/assert";
import {
  Direction,
  directionX,
  directionY,
  orientedDirection,
  TILE_DEFINITIONS,
  TileKind,
} from "./tile";
import type { World } from "./world";
import { WorldFeature } from "./world-features";
import { recordWeldAnimation } from "./weld-animation";

const enum EdgeIntent {
  None = 0,
  Split = -1,
  Weld = 1,
  Conflict = 2,
}

/**
 * Collects weld operator requests from one stable topology, rejects
 * opposing requests for the same edge, then commits every accepted edge as one
 * phase. Scratch buffers are retained across ticks.
 */
export class WeldOperationResolver {
  readonly successfulOperationIndices: Uint8Array;

  private readonly world: World;
  private readonly edgeIntents: Int8Array;
  private readonly changedEdges: Uint8Array;
  private readonly touchedEdgeWords: Uint32Array;

  constructor(world: World) {
    this.world = world;
    this.edgeIntents = new Int8Array(world.cellCount * 2);
    this.changedEdges = new Uint8Array(world.cellCount * 2);
    this.touchedEdgeWords = new Uint32Array(Math.ceil(this.edgeIntents.length / 32));
    this.successfulOperationIndices = new Uint8Array(world.cellCount);
  }

  collect(): void {
    for (
      let edge = this.firstTouchedEdge();
      edge >= 0;
      edge = this.nextTouchedEdge(edge)
    ) {
      this.edgeIntents[edge] = EdgeIntent.None;
      this.changedEdges[edge] = 0;
    }
    this.touchedEdgeWords.fill(0);
    for (
      let index = this.world.firstFeatureIndex(WorldFeature.WeldOperator);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.WeldOperator, index)
    ) {
      this.successfulOperationIndices[index] = 0;
      this.processOperatorEdges(index, true);
    }

    for (
      let edge = this.firstTouchedEdge();
      edge >= 0;
      edge = this.nextTouchedEdge(edge)
    ) {
      const intent = expectDefined(this.edgeIntents[edge], "weld operation edge intent");
      if (intent !== EdgeIntent.Weld && intent !== EdgeIntent.Split) {
        continue;
      }
      const { firstX, firstY, secondX, secondY } = this.edgeCoordinates(edge);
      if (
        TILE_DEFINITIONS[this.world.kindAt(firstX, firstY)].runtimeWeldProtected &&
        TILE_DEFINITIONS[this.world.kindAt(secondX, secondY)].runtimeWeldProtected
      ) {
        continue;
      }
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

    for (
      let index = this.world.firstFeatureIndex(WorldFeature.WeldOperator);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.WeldOperator, index)
    ) {
      this.processOperatorEdges(index, false);
    }
  }

  commit(): void {
    for (
      let edge = this.firstTouchedEdge();
      edge >= 0;
      edge = this.nextTouchedEdge(edge)
    ) {
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
      recordWeldAnimation(this.world, firstX, firstY, secondX, secondY, intent === EdgeIntent.Weld);
    }
  }

  /** Visit the same start-of-tick edges for intent collection and pulse attribution. */
  private processOperatorEdges(index: number, collecting: boolean): void {
    const kind = this.world.kindAtIndex(index);
    const orientation = this.world.orientationAtIndex(index);
    const leftSide = orientedDirection(
      Direction.Left, orientation, this.world.mirroredAtIndex(index),
    );
    if (this.world.chargeAtPortIndex(index, leftSide) === -1) {
      return;
    }
    const laser = kind === TileKind.LaserSplitter;
    const dismantler = kind === TileKind.Dismantler;
    const sideCount = laser ? 1 : dismantler ? 4 : 2;
    const sideStep = dismantler ? 1 : 2;
    const intent = kind === TileKind.Welder ? EdgeIntent.Weld : EdgeIntent.Split;
    let target = this.neighborIndex(index, orientation);
    while (target >= 0) {
      if (laser || this.world.kindAtIndex(target) !== TileKind.Empty) {
        for (let side = 0; side < sideCount; side += 1) {
          const direction = ((leftSide + side * sideStep) & 3) as Direction;
          const neighbor = this.neighborIndex(target, direction);
          if (neighbor < 0) {
            continue;
          }
          if (
            laser &&
            TILE_DEFINITIONS[this.world.kindAtIndex(target)].runtimeWeldProtected &&
            TILE_DEFINITIONS[this.world.kindAtIndex(neighbor)].runtimeWeldProtected
          ) {
            return;
          }
          const edge = this.edgeIndex(target, neighbor);
          if (collecting) {
            this.requestEdge(edge, intent);
          } else if (this.changedEdges[edge] === 1) {
            this.successfulOperationIndices[index] = 1;
            return;
          }
        }
      }
      if (!laser) {
        return;
      }
      target = this.neighborIndex(target, orientation);
    }
  }

  private requestEdge(edge: number, intent: EdgeIntent.Weld | EdgeIntent.Split): void {
    const existing = expectDefined(this.edgeIntents[edge], "existing weld operation intent");
    if (existing === EdgeIntent.None) {
      const word = edge >>> 5;
      this.touchedEdgeWords[word] =
        expectDefined(this.touchedEdgeWords[word], "touched weld edge word") |
        (1 << (edge & 31));
      this.edgeIntents[edge] = intent;
    } else if (existing !== intent) {
      this.edgeIntents[edge] = EdgeIntent.Conflict;
    }
  }

  private firstTouchedEdge(): number {
    return this.nextTouchedEdge(-1);
  }

  private nextTouchedEdge(after: number): number {
    let edge = after + 1;
    if (edge >= this.edgeIntents.length) {
      return -1;
    }
    let word = edge >>> 5;
    let candidates =
      expectDefined(this.touchedEdgeWords[word], "touched weld edge word") &
      (-1 << (edge & 31));
    while (true) {
      if (candidates !== 0) {
        return (word << 5) + 31 - Math.clz32(candidates & -candidates);
      }
      word += 1;
      if (word >= this.touchedEdgeWords.length) {
        return -1;
      }
      candidates = expectDefined(this.touchedEdgeWords[word], "touched weld edge word");
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
