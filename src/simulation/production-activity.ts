import type { World } from "./world";

export type ProductionActivity = "duplicator" | "assembler";

// Transient feedback only: never serialized or copied with a world.
const observations = new WeakMap<World, Set<ProductionActivity>>();

/** Start a fresh observation window, retaining storage across visible ticks. */
export function watchProductionActivity(world: World): ReadonlySet<ProductionActivity> {
  let activity = observations.get(world);
  if (activity === undefined) {
    activity = new Set();
    observations.set(world, activity);
  } else {
    activity.clear();
  }
  return activity;
}

/** Only successful commits report activity; unobserved boards allocate nothing. */
export function recordProductionActivity(world: World, activity: ProductionActivity): void {
  observations.get(world)?.add(activity);
}
