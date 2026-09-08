import { TileKind } from "./tile";
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

export function furnaceRecipeFor(input: TileKind): FurnaceRecipe | undefined {
  for (const recipe of FURNACE_RECIPES) {
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
