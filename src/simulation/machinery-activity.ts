import type { World } from "./world";

export type MachineryActivity = "duplicator" | "assembler" | "break" | "shatter" | "snap";

// Transient feedback only: never serialized or copied with a world.
const observations = new WeakMap<World, Set<MachineryActivity>>();

/** Start a fresh observation window, retaining storage across visible ticks. */
export function watchMachineryActivity(world: World): ReadonlySet<MachineryActivity> {
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
export function recordMachineryActivity(world: World, activity: MachineryActivity): void {
  observations.get(world)?.add(activity);
}
