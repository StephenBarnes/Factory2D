import type { Direction } from "./tile";
import type { World } from "./world";

/** Pre-reflection grid coordinates, keyed by carried stable tile ID. */
export interface FlipAnimationCell {
  readonly pivotX: number;
  readonly pivotY: number;
  readonly horizontally: boolean;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceOrientation: Direction;
}

type MutableFlipAnimationCell = {
  -readonly [Key in keyof FlipAnimationCell]: FlipAnimationCell[Key];
};

interface FlipAnimationState {
  previousWorld: World | null;
  previousRevision: number;
  committedRevision: number;
  capturing: boolean;
  used: number;
  readonly cells: Map<number, FlipAnimationCell>;
  readonly pool: MutableFlipAnimationCell[];
}

const animations = new WeakMap<World, FlipAnimationState>();

/** Records never travel through cloning or serialization, nor across snapshot edits. */
export function flipAnimationFor(
  world: World,
  previousWorld: World | null,
): ReadonlyMap<number, FlipAnimationCell> | null {
  const state = animations.get(world);
  if (state === undefined || state.capturing || previousWorld === null ||
    state.previousWorld !== previousWorld || state.previousRevision !== previousWorld.revision ||
    state.committedRevision !== world.revision || state.cells.size === 0) return null;
  return state.cells;
}

export function clearFlipAnimation(world: World): void {
  const state = animations.get(world);
  if (state === undefined) return;
  state.previousWorld = null;
  state.capturing = false;
  state.cells.clear();
  state.used = 0;
}

export function beginFlipAnimation(world: World, previousWorld: World | undefined): void {
  clearFlipAnimation(world);
  if (previousWorld === undefined || previousWorld === world ||
    previousWorld.width !== world.width || previousWorld.height !== world.height) return;
  let state = animations.get(world);
  if (state === undefined) {
    state = {
      previousWorld: null, previousRevision: -1, committedRevision: -1,
      capturing: false, used: 0, cells: new Map(), pool: [],
    };
    animations.set(world, state);
  }
  state.previousWorld = previousWorld;
  state.capturing = true;
}

/** Called for accepted, nonjammed flips, before the head seam is split. */
export function recordFlipAnimation(
  world: World,
  selected: readonly number[],
  pivot: number,
  horizontally: boolean,
): void {
  const state = animations.get(world);
  if (state === undefined || !state.capturing) return;
  const pivotX = pivot % world.width;
  const pivotY = Math.floor(pivot / world.width);
  for (const source of selected) {
    const sourceOrientation = world.orientationAtIndex(source);
    let cell = state.pool[state.used];
    if (cell === undefined) {
      cell = { pivotX, pivotY, horizontally, sourceX: 0, sourceY: 0, sourceOrientation };
      state.pool.push(cell);
    }
    cell.pivotX = pivotX;
    cell.pivotY = pivotY;
    cell.horizontally = horizontally;
    cell.sourceX = source % world.width;
    cell.sourceY = Math.floor(source / world.width);
    cell.sourceOrientation = sourceOrientation;
    state.cells.set(world.idAtIndex(source), cell);
    state.used += 1;
  }
}

/** Seal after all nested and parent phases, including interpolation-source production. */
export function sealFlipAnimation(world: World): void {
  const state = animations.get(world);
  if (state === undefined || !state.capturing || state.previousWorld === null) return;
  state.previousRevision = state.previousWorld.revision;
  state.committedRevision = world.revision;
  state.capturing = false;
}
