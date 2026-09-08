import { TileKind } from "./tile";

export interface FurnaceRecipe {
  readonly input: TileKind;
  readonly output: TileKind;
  readonly bakeTime: number;
  /** Neighbor kinds observed before cooking that the finished product joins. */
  readonly weldTo?: readonly TileKind[];
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
]);

export function furnaceRecipeFor(input: TileKind): FurnaceRecipe | undefined {
  for (const recipe of FURNACE_RECIPES) {
    if (recipe.input === input) {
      return recipe;
    }
  }
  return undefined;
}
