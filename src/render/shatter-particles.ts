import type { ShatterAnimation } from "../simulation/shatter-animation";
import { TILE_DEFINITIONS } from "../simulation/tile";

// One normal-speed tick; wall-clock timing also lets single-step/paused effects finish.
const SHATTER_DURATION_MS = 200;
let slab: Path2D | undefined;
let leftHalf: Path2D | undefined;
let rightHalf: Path2D | undefined;

/** Two undecorated rounded-slab halves separate across a cut 30 degrees from vertical. */
export function drawShatterParticles(
  context: CanvasRenderingContext2D,
  cells: Map<number, ShatterAnimation>,
  width: number,
  height: number,
  originX: number,
  originY: number,
  cellSize: number,
): boolean {
  if (cells.size === 0) return false;
  if (slab === undefined || leftHalf === undefined || rightHalf === undefined) {
    slab = new Path2D();
    slab.roundRect(-0.44, -0.44, 0.88, 0.88, 0.09);
    leftHalf = new Path2D();
    leftHalf.moveTo(-1, -1);
    leftHalf.lineTo(-0.57735, -1);
    leftHalf.lineTo(0.57735, 1);
    leftHalf.lineTo(-1, 1);
    leftHalf.closePath();
    rightHalf = new Path2D();
    rightHalf.moveTo(-0.57735, -1);
    rightHalf.lineTo(1, -1);
    rightHalf.lineTo(1, 1);
    rightHalf.lineTo(0.57735, 1);
    rightHalf.closePath();
  }
  const now = performance.now();
  context.save();
  context.beginPath();
  context.rect(originX, originY, width * cellSize, height * cellSize);
  context.clip();
  for (const [index, animation] of cells) {
    const progress = (now - animation.startedAt) / SHATTER_DURATION_MS;
    if (progress >= 1) {
      cells.delete(index);
      continue;
    }
    const remaining = 1 - progress;
    const distance = 0.28 * (1 - remaining * remaining);
    const drop = 0.12 * progress * progress;
    const x = originX + ((index % width) + 0.5) * cellSize;
    const y = originY + (Math.floor(index / width) + 0.5) * cellSize;
    context.fillStyle = TILE_DEFINITIONS[animation.kind].fill;
    context.globalAlpha = remaining;
    for (let side = -1; side <= 1; side += 2) {
      context.save();
      context.translate(x, y);
      context.scale(cellSize, cellSize);
      context.translate(side * distance * 0.866025, drop - side * distance * 0.5);
      context.clip(side === -1 ? leftHalf : rightHalf);
      context.fill(slab);
      context.restore();
    }
  }
  context.restore();
  return cells.size > 0;
}
