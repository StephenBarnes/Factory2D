import { recordMachineryActivity } from "./machinery-activity";
import { TILE_DEFINITIONS, TileKind } from "./tile";
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
export function recordShatterEffects(
  world: World, index: number, site = index, kind = world.kindAtIndex(index),
): void {
  recordMachineryActivity(world,
    kind === TileKind.Fastener ? "snap" : TILE_DEFINITIONS[kind].fragile ? "shatter" : "break", site);
  const cells = animations.get(world);
  if (cells === undefined) return;
  const animation = cells.get(site);
  if (animation === undefined) {
    cells.set(site, { startedAt: performance.now(), kind });
  } else {
    // Bound retained effects to one per cell, even during fast simulation.
    animation.startedAt = performance.now();
    animation.kind = kind;
  }
}
