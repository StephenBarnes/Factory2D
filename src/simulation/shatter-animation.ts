import type { TileKind } from "./tile";
import type { World } from "./world";

export interface ShatterAnimation {
  startedAt: number;
  kind: TileKind;
}

/** Render-only destruction sites; neither snapshots nor scene exports retain these. */
const animations = new WeakMap<World, Map<number, ShatterAnimation>>();

/** Remounting a board discards effects recorded while its view was hidden. */
export function watchShatterAnimation(world: World): Map<number, ShatterAnimation> {
  const cells = new Map<number, ShatterAnimation>();
  animations.set(world, cells);
  return cells;
}

/** Call immediately before committed destruction, not ordinary erasing or consumption. */
export function recordShatterAnimation(world: World, index: number): void {
  const cells = animations.get(world);
  if (cells === undefined) return;
  const kind = world.kindAtIndex(index);
  const animation = cells.get(index);
  if (animation === undefined) {
    cells.set(index, { startedAt: performance.now(), kind });
  } else {
    // Bound retained effects to one per cell, even during fast simulation.
    animation.startedAt = performance.now();
    animation.kind = kind;
  }
}
