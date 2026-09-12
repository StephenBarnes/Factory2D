import { TILE_DEFINITIONS, TILE_KINDS, TileKind } from "./tile";
import type { World } from "./world";

export interface FurnaceRecipe {
  readonly input: TileKind;
  readonly output: TileKind;
  readonly bakeTime: number;
  /** Neighbor kinds observed before cooking that the finished product joins. */
  readonly weldTo?: readonly TileKind[];
  /** Each listed kind must touch the target orthogonally; neighbors are not consumed. */
  readonly requiredNeighbors?: readonly TileKind[];
}

/** Furnace recipes and their required active ticks. */
export const FURNACE_RECIPES: readonly FurnaceRecipe[] = Object.freeze([
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
    requiredNeighbors: Object.freeze([TileKind.Wood]),
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
): boolean {
  if (recipe.requiredNeighbors === undefined) return true;
  const x = targetIndex % world.width;
  for (const kind of recipe.requiredNeighbors) {
    if (targetIndex >= world.width && world.kindAtIndex(targetIndex - world.width) === kind) continue;
    if (x + 1 < world.width && world.kindAtIndex(targetIndex + 1) === kind) continue;
    if (targetIndex + world.width < world.cellCount && world.kindAtIndex(targetIndex + world.width) === kind) continue;
    if (x > 0 && world.kindAtIndex(targetIndex - 1) === kind) continue;
    return false;
  }
  return true;
}
