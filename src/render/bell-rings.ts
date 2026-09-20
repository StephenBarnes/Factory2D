import { TILE_DEFINITIONS, TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";

const RING_DURATION_MS = 600;
const SECOND_RING_DELAY_MS = 120;

/** Render-only ring sites, bounded to one pair per cell; never cloned or serialized. */
const rings = new WeakMap<World, Map<number, number>>();

/** Remounting a board discards rings recorded while its view was hidden. */
export function watchBellRings(world: World): Map<number, number> {
  const cells = new Map<number, number>();
  rings.set(world, cells);
  return cells;
}

export function recordBellRing(world: World, index: number): void {
  rings.get(world)?.set(index, performance.now());
}

/** Two faint, staggered circles expand from the committed ringing site. */
export function drawBellRings(
  context: CanvasRenderingContext2D,
  cells: Map<number, number>,
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
  context.strokeStyle = TILE_DEFINITIONS[TileKind.Bell].decorationColor;
  context.lineWidth = Math.max(1, cellSize * 0.025);
  for (const [index, startedAt] of cells) {
    const elapsed = now - startedAt;
    if (elapsed >= RING_DURATION_MS + SECOND_RING_DELAY_MS) {
      cells.delete(index);
      continue;
    }
    const x = originX + ((index % width) + 0.5) * cellSize;
    const y = originY + (Math.floor(index / width) + 0.5) * cellSize;
    for (let ring = 0; ring < 2; ring += 1) {
      const progress = (elapsed - ring * SECOND_RING_DELAY_MS) / RING_DURATION_MS;
      if (progress < 0 || progress >= 1) continue;
      context.globalAlpha = 0.4 * (1 - progress);
      context.beginPath();
      context.arc(x, y, (0.4 + 1.6 * progress) * cellSize, 0, Math.PI * 2);
      context.stroke();
    }
  }
  context.restore();
  return cells.size > 0;
}
