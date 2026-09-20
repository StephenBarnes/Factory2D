import { Direction, TILE_DEFINITIONS, TILE_KINDS, TileKind } from "./tile";
import type { World } from "./world";

export interface FurnaceRecipe {
  readonly input: TileKind;
  readonly output: TileKind;
  readonly bakeTime: number;
  /** Neighbor kinds after all cooking transformations that the finished product joins. */
  readonly weldTo?: readonly TileKind[];
  /** Required target surroundings; completion transforms all orthogonal matches if output is set. */
  readonly requiredNeighbors?: readonly {
    readonly kind: TileKind;
    /** Relative to the furnace's facing; omitted means any orthogonal neighbor. */
    readonly placement?: "any" | "lateral" | "both-lateral" | "three-sides";
    readonly output?: TileKind;
  }[];
}

/** Furnace recipes and their required active ticks. */
export const FURNACE_RECIPES: readonly FurnaceRecipe[] = Object.freeze([
  Object.freeze({ input: TileKind.Wood, output: TileKind.Fire, bakeTime: 2 }),
  Object.freeze({
    input: TileKind.Sand,
    output: TileKind.Glass,
    bakeTime: 4,
    weldTo: Object.freeze([TileKind.Glass]),
  }),
  Object.freeze({ input: TileKind.IronOre, output: TileKind.Iron, bakeTime: 6 }),
  Object.freeze({
    input: TileKind.CopperOre,
    output: TileKind.Copper,
    bakeTime: 6,
    requiredNeighbors: Object.freeze([Object.freeze({ kind: TileKind.Wood, output: TileKind.Fire })]),
  }),
  Object.freeze({
    input: TileKind.TinOre,
    output: TileKind.Tin,
    bakeTime: 6,
    requiredNeighbors: Object.freeze([
      Object.freeze({ kind: TileKind.Wood, output: TileKind.Fire, placement: "lateral" as const }),
    ]),
  }),
  Object.freeze({
    input: TileKind.Iron,
    output: TileKind.Steel,
    bakeTime: 8,
    requiredNeighbors: Object.freeze([
      Object.freeze({ kind: TileKind.Wood, output: TileKind.Fire, placement: "both-lateral" as const }),
    ]),
  }),
  Object.freeze({
    input: TileKind.Copper,
    output: TileKind.Bronze,
    bakeTime: 8,
    requiredNeighbors: Object.freeze([
      Object.freeze({ kind: TileKind.Tin, placement: "three-sides" as const }),
    ]),
  }),
]);

/** Grinding uses the furnace progress lifecycle but never smelts its inputs. */
export const GRINDER_RECIPES: readonly FurnaceRecipe[] = Object.freeze([
  Object.freeze({ input: TileKind.Stone, output: TileKind.Sand, bakeTime: 4 }),
  Object.freeze({ input: TileKind.Glass, output: TileKind.Sand, bakeTime: 4 }),
]);

export const DRILL_TICKS = 4;

/** Drilling shares processing state and ports, but commits destruction in its own phase. */
const DRILL_RECIPES = new Map<TileKind, FurnaceRecipe>(
  TILE_KINDS
    .filter((kind) => kind !== TileKind.Empty && !TILE_DEFINITIONS[kind].indestructible)
    .map((input) => [input, Object.freeze({ input, output: TileKind.Empty, bakeTime: DRILL_TICKS })]),
);

export function isProcessingMachine(kind: TileKind): boolean {
  return kind === TileKind.Furnace || kind === TileKind.Grinder || kind === TileKind.Drill;
}

export function processingRecipeFor(machine: TileKind, input: TileKind): FurnaceRecipe | undefined {
  if (machine === TileKind.Drill) return DRILL_RECIPES.get(input);
  const recipes = machine === TileKind.Furnace ? FURNACE_RECIPES
    : machine === TileKind.Grinder ? GRINDER_RECIPES : undefined;
  if (recipes === undefined) return undefined;
  for (const recipe of recipes) {
    if (recipe.input === input) {
      return recipe;
    }
  }
  return undefined;
}

/** Missing surroundings pause cooking without discarding accumulated progress. */
export function furnaceNeighborsPresent(
  world: World,
  targetIndex: number,
  recipe: FurnaceRecipe,
  orientation: Direction,
): boolean {
  if (recipe.requiredNeighbors === undefined) return true;
  const x = targetIndex % world.width;
  for (const { kind, placement = "any" } of recipe.requiredNeighbors) {
    let neighbors = 0;
    if (targetIndex >= world.width && world.kindAtIndex(targetIndex - world.width) === kind) {
      neighbors |= 1 << Direction.Up;
    }
    if (x + 1 < world.width && world.kindAtIndex(targetIndex + 1) === kind) {
      neighbors |= 1 << Direction.Right;
    }
    if (targetIndex + world.width < world.cellCount && world.kindAtIndex(targetIndex + world.width) === kind) {
      neighbors |= 1 << Direction.Down;
    }
    if (x > 0 && world.kindAtIndex(targetIndex - 1) === kind) {
      neighbors |= 1 << Direction.Left;
    }
    const lateral = (1 << ((orientation + 1) & 3)) | (1 << ((orientation + 3) & 3));
    switch (placement) {
      case "any":
        if (neighbors === 0) return false;
        break;
      case "lateral":
        if ((neighbors & lateral) === 0) return false;
        break;
      case "both-lateral":
        if ((neighbors & lateral) !== lateral) return false;
        break;
      case "three-sides": {
        const required = lateral | (1 << orientation);
        if ((neighbors & required) !== required) return false;
        break;
      }
    }
  }
  return true;
}
