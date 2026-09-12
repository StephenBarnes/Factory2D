import type { World } from "./world";

export interface WeldAnimation {
  startedAt: number;
  welded: boolean;
}

/** Render-only edge flashes; never copied, serialized, or read by physics. */
const animations = new WeakMap<World, Map<number, WeldAnimation>>();

/** A newly mounted view starts fresh rather than replaying offscreen operations. */
export function watchWeldAnimation(world: World): Map<number, WeldAnimation> {
  const edges = new Map<number, WeldAnimation>();
  animations.set(world, edges);
  return edges;
}

/** Record only successful tool/machine operations, not topology copied during motion. */
export function recordWeldAnimation(
  world: World,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  welded: boolean,
): void {
  const edges = animations.get(world);
  if (edges === undefined) return;
  const first = Math.min(y1 * world.width + x1, y2 * world.width + x2);
  const edge = first * 2 + (x1 === x2 ? 1 : 0);
  // Repeated operations refresh one flash; storage is bounded by the board's edges.
  const animation = edges.get(edge);
  if (animation === undefined) {
    edges.set(edge, { startedAt: performance.now(), welded });
  } else {
    animation.startedAt = performance.now();
    animation.welded = welded;
  }
}
