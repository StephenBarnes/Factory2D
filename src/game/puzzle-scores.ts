import type { PuzzleDefinition } from "./puzzles";
import { TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";
import { expectDefined } from "../util/assert";

export interface PuzzleScores {
  readonly price: number;
  readonly cycles: number;
  readonly footprint: number;
  readonly combined: number;
}

export function computePuzzleScores(
  puzzle: PuzzleDefinition,
  solution: World,
  cycles: number,
): PuzzleScores {
  if (!Number.isSafeInteger(cycles) || cycles < 0) {
    throw new RangeError("Puzzle score cycles must be a non-negative safe integer");
  }

  let price = 0;
  let left = solution.width;
  let top = solution.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < solution.height; y += 1) {
    for (let x = 0; x < solution.width; x += 1) {
      if (!puzzle.editableRegion.contains(x, y)) {
        continue;
      }
      const kind = solution.kindAt(x, y);
      if (kind === TileKind.Empty) {
        continue;
      }

      const componentPrice = expectDefined(
        puzzle.availableComponents.priceOf(kind) ?? undefined,
        `Missing price for solution component ${kind}`,
      );
      price += componentPrice;
      if (!Number.isSafeInteger(price)) {
        throw new RangeError("Puzzle solution price exceeds the safe integer range");
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  const footprint = right < left ? 0 : (right - left + 1) * (bottom - top + 1);
  const combined = price + cycles + footprint;
  if (!Number.isSafeInteger(combined)) {
    throw new RangeError("Combined puzzle score exceeds the safe integer range");
  }

  return Object.freeze({ price, cycles, footprint, combined });
}

export function parsePuzzleScores(value: unknown, context: string): PuzzleScores {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} scores must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const field of ["price", "cycles", "footprint", "combined"] as const) {
    if (!Number.isSafeInteger(record[field]) || (record[field] as number) < 0) {
      throw new Error(`${context} score ${field} must be a non-negative safe integer`);
    }
  }
  if (record.combined !== (record.price as number) + (record.cycles as number) + (record.footprint as number)) {
    throw new Error(`${context} combined score is inconsistent`);
  }

  return Object.freeze({
    price: record.price as number,
    cycles: record.cycles as number,
    footprint: record.footprint as number,
    combined: record.combined as number,
  });
}
