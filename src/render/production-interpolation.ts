import {
  productionAnimationMatches,
  watchProductionAnimation,
  type ProductionAnimationObserver,
} from "../simulation/production-animation";
import { WorldFeature } from "../simulation/world-features";
import type { World } from "../simulation/world";
import { createBodyCell, populateBodyCell } from "./body-cells";
import { tileAppearance } from "./appearance";
import { createBodyPath, drawBody, type BodyCell } from "./tile-renderer";

interface MachineOrigin {
  readonly group: number;
  readonly x: number;
  readonly y: number;
  currentX: number;
  currentY: number;
}

interface ConsumedBody {
  readonly origin: MachineOrigin;
  readonly cells: BodyCell[];
  path: Path2D | null;
  cellSize: number;
  angularOutlines: boolean;
}

/** Artwork and paths exist only in the mounted view, never in simulation snapshots. */
export class ProductionInterpolation implements ProductionAnimationObserver {
  private readonly origins = new Map<number, MachineOrigin>();
  private readonly produced = new Map<number, MachineOrigin>();
  private readonly consumed = new Map<number, ConsumedBody>();
  private positionedRevision = -1;
  active = false;
  progress = 1;

  constructor(private readonly world: World) {
    watchProductionAnimation(world, this);
  }

  clear(): void {
    this.origins.clear();
    this.produced.clear();
    this.consumed.clear();
    this.positionedRevision = -1;
    this.active = false;
  }

  capture(index: number, machine: number, producing: boolean): void {
    const world = this.world;
    const machineId = world.idAtIndex(machine);
    let origin = this.origins.get(machineId);
    if (origin === undefined) {
      const x = machine % world.width + 0.5;
      const y = Math.floor(machine / world.width) + 0.5;
      origin = { group: machineId, x, y, currentX: x, currentY: y };
      this.origins.set(machineId, origin);
    }
    if (producing) {
      this.produced.set(world.idAtIndex(index), origin);
      return;
    }
    let body = this.consumed.get(machineId);
    if (body === undefined) {
      body = { origin, cells: [], path: null, cellSize: -1, angularOutlines: tileAppearance.angularOutlines };
      this.consumed.set(machineId, body);
    }
    const cell = createBodyCell();
    populateBodyCell(world, index, cell);
    cell.seamRight = !world.hasRightWeldAtIndex(index);
    cell.seamDown = !world.hasDownWeldAtIndex(index);
    body.cells.push(cell);
  }

  prepare(previous: World | null, progress: number): void {
    this.progress = progress;
    this.active = progress < 1 && (this.produced.size > 0 || this.consumed.size > 0) &&
      productionAnimationMatches(this.world, previous, this);
    if (!this.active || this.positionedRevision === this.world.revision) return;
    this.positionedRevision = this.world.revision;
    for (const feature of [WorldFeature.Delivery, WorldFeature.Assembler, WorldFeature.Duplicator]) {
      for (let index = this.world.firstFeatureIndex(feature); index >= 0;
        index = this.world.nextFeatureIndex(feature, index)) {
        const origin = this.origins.get(this.world.idAtIndex(index));
        if (origin === undefined) continue;
        origin.currentX = index % this.world.width + 0.5;
        origin.currentY = Math.floor(index / this.world.width) + 0.5;
      }
    }
  }

  originAt(index: number): MachineOrigin | undefined {
    return this.active ? this.produced.get(this.world.idAtIndex(index)) : undefined;
  }

  drawConsumed(
    context: CanvasRenderingContext2D, originX: number, originY: number,
    cellSize: number, animationTime: number,
  ): void {
    if (!this.active) return;
    const scale = 1 - this.progress;
    context.save();
    context.beginPath();
    context.rect(originX, originY, this.world.width * cellSize, this.world.height * cellSize);
    context.clip();
    for (const body of this.consumed.values()) {
      if (body.path === null || body.cellSize !== cellSize ||
        body.angularOutlines !== tileAppearance.angularOutlines) {
        body.path = createBodyPath(0, 0, cellSize, body.cells, body.cells.length);
        body.cellSize = cellSize;
        body.angularOutlines = tileAppearance.angularOutlines;
      }
      const origin = body.origin;
      context.save();
      context.globalAlpha *= scale;
      context.translate(
        originX + this.progress * origin.currentX * cellSize,
        originY + this.progress * origin.currentY * cellSize,
      );
      context.scale(scale, scale);
      drawBody(context, 0, 0, cellSize, body.cells, body.cells.length, body.path, animationTime);
      context.restore();
    }
    context.restore();
  }
}
