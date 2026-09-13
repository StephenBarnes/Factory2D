import type { ProcessingAnimation } from "../simulation/processing-animation";
import { TILE_DEFINITIONS } from "../simulation/tile";

const PARTICLE_DURATION_MS = 450;
// Fixed trajectories avoid random state and per-frame trigonometry or allocation.
const TRAJECTORIES = [
  [1, -0.25], [0.55, -0.9], [-0.2, -1], [-0.85, -0.55],
  [-1, 0.2], [-0.45, 0.85], [0.3, 1], [0.9, 0.6],
] as const;

/** Product-colored chips burst from the processing site, independent of tile motion. */
export function drawProcessingParticles(
  context: CanvasRenderingContext2D,
  cells: Map<number, ProcessingAnimation>,
  width: number,
  height: number,
  originX: number,
  originY: number,
  cellSize: number,
): boolean {
  if (cells.size === 0) return false;
  const now = performance.now();
  context.save();
  context.beginPath();
  context.rect(originX, originY, width * cellSize, height * cellSize);
  context.clip();
  for (const [index, animation] of cells) {
    const progress = (now - animation.startedAt) / PARTICLE_DURATION_MS;
    if (progress >= 1) {
      cells.delete(index);
      continue;
    }
    const x = originX + ((index % width) + 0.5) * cellSize;
    const y = originY + (Math.floor(index / width) + 0.5) * cellSize;
    const remaining = 1 - progress;
    const distance = (0.25 + 0.65 * (1 - remaining * remaining)) * cellSize;
    const drop = progress * progress * 0.25 * cellSize;
    const size = Math.max(1, cellSize * 0.075) * (1 - progress * 0.5);
    const definition = TILE_DEFINITIONS[animation.kind];
    context.globalAlpha = remaining * remaining;
    context.fillStyle = definition.fill;
    context.strokeStyle = definition.decorationColor;
    context.lineWidth = size * 0.25;
    for (const [dx, dy] of TRAJECTORIES) {
      const left = x + dx * distance - size / 2;
      const top = y + dy * distance + drop - size / 2;
      context.fillRect(left, top, size, size);
      context.strokeRect(left, top, size, size);
    }
  }
  context.restore();
  return cells.size > 0;
}
