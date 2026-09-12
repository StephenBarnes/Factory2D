import type { World } from "./world";

/** Grid coordinates immediately before an accepted quarter-turn, keyed by carried tile ID. */
export interface RotationAnimationCell {
  readonly pivotX: number;
  readonly pivotY: number;
  readonly quarterTurn: -1 | 1;
  readonly sourceX: number;
  readonly sourceY: number;
}

type MutableRotationAnimationCell = {
  -readonly [Key in keyof RotationAnimationCell]: RotationAnimationCell[Key];
};

interface RotationAnimationState {
  previousWorld: World | null;
  previousRevision: number;
  committedRevision: number;
  capturing: boolean;
  used: number;
  readonly cells: Map<number, RotationAnimationCell>;
  readonly pool: MutableRotationAnimationCell[];
}

const animations = new WeakMap<World, RotationAnimationState>();

/** Records are transient: neither world serialization nor cloning carries them. */
export function rotationAnimationFor(
  world: World,
  previousWorld: World | null,
): ReadonlyMap<number, RotationAnimationCell> | null {
  const state = animations.get(world);
  if (
    state === undefined ||
    state.capturing ||
    previousWorld === null ||
    state.previousWorld !== previousWorld ||
    state.previousRevision !== previousWorld.revision ||
    state.committedRevision !== world.revision ||
    state.cells.size === 0
  ) {
    return null;
  }
  return state.cells;
}

export function clearRotationAnimation(world: World): void {
  const state = animations.get(world);
  if (state === undefined) return;
  state.previousWorld = null;
  state.capturing = false;
  state.cells.clear();
  state.used = 0;
}

export function beginRotationAnimation(world: World, previousWorld: World | undefined): void {
  clearRotationAnimation(world);
  if (
    previousWorld === undefined ||
    previousWorld === world ||
    previousWorld.width !== world.width ||
    previousWorld.height !== world.height
  ) {
    return;
  }
  let state = animations.get(world);
  if (state === undefined) {
    state = {
      previousWorld: null,
      previousRevision: -1,
      committedRevision: -1,
      capturing: false,
      used: 0,
      cells: new Map(),
      pool: [],
    };
    animations.set(world, state);
  }
  state.previousWorld = previousWorld;
  state.capturing = true;
}

/** Called only for accepted, nonjammed proposals, before their cells are moved. */
export function recordRotationAnimation(
  world: World,
  selected: readonly number[],
  pivot: number,
  quarterTurn: -1 | 1,
): void {
  const state = animations.get(world);
  if (state === undefined || !state.capturing) return;
  const pivotX = pivot % world.width;
  const pivotY = Math.floor(pivot / world.width);
  for (const source of selected) {
    let cell = state.pool[state.used];
    if (cell === undefined) {
      cell = { pivotX, pivotY, quarterTurn, sourceX: 0, sourceY: 0 };
      state.pool.push(cell);
    }
    cell.pivotX = pivotX;
    cell.pivotY = pivotY;
    cell.quarterTurn = quarterTurn;
    cell.sourceX = source % world.width;
    cell.sourceY = Math.floor(source / world.width);
    state.cells.set(world.idAtIndex(source), cell);
    state.used += 1;
  }
}

/** Seal after every world's phases: production may also change the prior snapshot. */
export function sealRotationAnimation(world: World): void {
  const state = animations.get(world);
  if (state === undefined || !state.capturing || state.previousWorld === null) return;
  state.previousRevision = state.previousWorld.revision;
  state.committedRevision = world.revision;
  state.capturing = false;
}
