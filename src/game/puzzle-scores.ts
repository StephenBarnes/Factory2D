import type { PuzzleDefinition } from "./puzzles";
import type { GridRectangle } from "./grid-region";
import { TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";
import { expectDefined } from "../util/assert";

export interface PuzzleScores {
  readonly price: number;
  /** Arithmetic mean of cycles across all test cases, without rounding. */
  readonly cycles: number;
  readonly footprint: number;
  readonly combined: number;
}
export interface PuzzleDesignMetrics {
  readonly price: number;
  readonly footprintWidth: number;
  readonly footprintHeight: number;
  readonly footprintBounds: GridRectangle | null;
}


export function computePuzzleDesignMetrics(
  puzzle: PuzzleDefinition,
  solution: World,
): PuzzleDesignMetrics {
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

      price += componentPrice(puzzle, solution, x, y);
      if (!Number.isSafeInteger(price)) {
        throw new RangeError("Puzzle solution price exceeds the safe integer range");
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  return Object.freeze({
    price,
    footprintWidth: right < left ? 0 : right - left + 1,
    footprintHeight: bottom < top ? 0 : bottom - top + 1,
    footprintBounds: right < left ? null : Object.freeze({
      x: left, y: top, width: right - left + 1, height: bottom - top + 1,
    }),
  });
}

/**
 * Price of one placed component. Rune arrays cost their own price plus the full price of
 * every component on their inner board, recursively, so they tidy circuits without making
 * them cheaper.
 */
function componentPrice(puzzle: PuzzleDefinition, world: World, x: number, y: number): number {
  const kind = world.kindAt(x, y);
  let price = expectDefined(
    puzzle.availableComponents.priceOf(kind) ?? undefined,
    `Missing price for solution component ${kind}`,
  );
  if (kind === TileKind.RuneArray) {
    const inner = world.runeArrayWorldAt(x, y);
    for (let innerY = 0; innerY < inner.height; innerY += 1) {
      for (let innerX = 0; innerX < inner.width; innerX += 1) {
        if (inner.kindAt(innerX, innerY) !== TileKind.Empty) {
          price += componentPrice(puzzle, inner, innerX, innerY);
        }
      }
    }
  }
  return price;
}

export function computePuzzleScores(
  puzzle: PuzzleDefinition,
  solution: World,
  cycles: number,
): PuzzleScores {
  if (!isScoreNumber(cycles)) {
    throw new RangeError("Puzzle score cycles must be a non-negative finite number within the safe range");
  }

  const metrics = computePuzzleDesignMetrics(puzzle, solution);
  const footprint = metrics.footprintWidth * metrics.footprintHeight;
  const combined = metrics.price + cycles + footprint;
  if (!isScoreNumber(combined)) {
    throw new RangeError("Combined puzzle score exceeds the safe integer range");
  }

  return Object.freeze({ price: metrics.price, cycles, footprint, combined });
}

export function parsePuzzleScores(
  value: unknown,
  context: string,
  kind: "solution" | "independent-minima" = "solution",
): PuzzleScores {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} scores must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const field of ["price", "cycles", "footprint", "combined"] as const) {
    const score = record[field];
    if (!isScoreNumber(score) || ((field === "price" || field === "footprint") && !Number.isSafeInteger(score))) {
      throw new Error(`${context} score ${field} must be non-negative and within the safe range; price and footprint must be integers`);
    }
  }
  // Independent minima may come from different solutions; combined is still an
  // actual solution's best total, never the sum of those independent minima.
  const sum = (record.price as number) + (record.cycles as number) + (record.footprint as number);
  if (kind === "solution" ? record.combined !== sum : (record.combined as number) < sum) {
    throw new Error(`${context} combined score is inconsistent`);
  }

  return Object.freeze({
    price: record.price as number,
    cycles: record.cycles as number,
    footprint: record.footprint as number,
    combined: record.combined as number,
  });
}

function isScoreNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}
