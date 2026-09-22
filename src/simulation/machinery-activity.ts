import type { World } from "./world";

export type MachineryActivity = "duplicator" | "assembler" | "break" | "shatter" | "snap" | "bomb";

export interface MachineryActivityEvent {
  readonly voice: MachineryActivity;
  readonly index: number;
}

interface ActivityObservation {
  readonly events: MachineryActivityEvent[];
  active: boolean;
}

// Transient feedback only: never serialized or copied with a world.
const observations = new WeakMap<World, ActivityObservation>();

/** Start a fresh observation window, retaining storage across visible ticks. */
export function watchMachineryActivity(world: World): readonly MachineryActivityEvent[] {
  let activity = observations.get(world);
  if (activity === undefined) {
    activity = { events: [], active: true };
    observations.set(world, activity);
  } else {
    activity.events.length = 0;
    activity.active = true;
  }
  return activity.events;
}

/** Stop retaining commits after collection, including worlds removed from the observed tree. */
export function finishMachineryActivity(world: World): void {
  const activity = observations.get(world);
  if (activity !== undefined) activity.active = false;
}

/** Only successful commits report activity; unobserved boards allocate nothing. */
export function recordMachineryActivity(world: World, voice: MachineryActivity, index: number): void {
  const activity = observations.get(world);
  if (activity?.active) activity.events.push({ voice, index });
}
