import type { TileKind } from "./tile";
import type { World } from "./world";

export interface ProcessingAnimation {
  startedAt: number;
  kind: TileKind;
}

/** Render-only completion bursts, following the weld-animation watch lifecycle. */
const animations = new WeakMap<World, Map<number, ProcessingAnimation>>();

/** Mounting a view discards effects from operations performed while it was hidden. */
export function watchProcessingAnimation(world: World): Map<number, ProcessingAnimation> {
  const cells = new Map<number, ProcessingAnimation>();
  animations.set(world, cells);
  return cells;
}

/** Called only where a furnace/grinder product is committed, never for copied state. */
export function recordProcessingAnimation(world: World, index: number, kind: TileKind): void {
  const cells = animations.get(world);
  if (cells === undefined) return;
  const animation = cells.get(index);
  if (animation === undefined) {
    cells.set(index, { startedAt: performance.now(), kind });
  } else {
    // Refresh repeated processing at one site; storage stays bounded by board cells.
    animation.startedAt = performance.now();
    animation.kind = kind;
  }
}
