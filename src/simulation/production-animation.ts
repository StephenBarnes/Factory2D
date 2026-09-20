import type { World } from "./world";

/** A mounted view captures artwork before consumption; simulation retains no render data. */
export interface ProductionAnimationObserver {
  clear(): void;
  capture(index: number, machine: number, producing: boolean): void;
}

interface Observation {
  readonly observer: ProductionAnimationObserver;
  previous: World | null;
  previousRevision: number;
  committedRevision: number;
  capturing: boolean;
}

const observations = new WeakMap<World, Observation>();

export function watchProductionAnimation(world: World, observer: ProductionAnimationObserver): void {
  observations.set(world, {
    observer, previous: null, previousRevision: -1, committedRevision: -1, capturing: false,
  });
}

export function clearProductionAnimation(world: World): void {
  const state = observations.get(world);
  if (state === undefined) return;
  state.observer.clear();
  state.previous = null;
  state.capturing = false;
}

export function beginProductionAnimation(world: World, previous: World | undefined): void {
  clearProductionAnimation(world);
  const state = observations.get(world);
  if (state === undefined || previous === undefined || previous === world ||
      previous.width !== world.width || previous.height !== world.height) return;
  state.previous = previous;
  state.capturing = true;
}

export function sealProductionAnimation(world: World): void {
  const state = observations.get(world);
  if (state === undefined || !state.capturing || state.previous === null) return;
  state.previousRevision = state.previous.revision;
  state.committedRevision = world.revision;
  state.capturing = false;
}

export function productionAnimationMatches(
  world: World, previous: World | null, observer: ProductionAnimationObserver,
): boolean {
  const state = observations.get(world);
  return state !== undefined && state.observer === observer && !state.capturing &&
    previous !== null && state.previous === previous &&
    state.previousRevision === previous.revision && state.committedRevision === world.revision;
}

/** Capture all seams and charges before any member is cleared. Unwatched ticks do no scan. */
export function recordConsumption(world: World, owners: Int32Array, machine: number): void {
  const state = observations.get(world);
  if (state === undefined || !state.capturing) return;
  for (let index = 0; index < owners.length; index += 1) {
    if (owners[index] === machine) state.observer.capture(index, machine, false);
  }
}

export function recordProduction(world: World, index: number, machine: number): void {
  const state = observations.get(world);
  if (state?.capturing) state.observer.capture(index, machine, true);
}
