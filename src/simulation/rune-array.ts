import type { Charge } from "./circuit";
import { Direction, flipDirectionHorizontally, flipDirectionVertically } from "./tile";

/**
 * Pure rune-array geometry and configuration rules shared by the world, the
 * circuit solver, serialization, and the workshop. A rune array holds a
 * miniature board whose four edge-center cells are logically connected to the
 * array's four outer sides; odd dimensions keep those centers exact.
 */
export const MIN_RUNE_ARRAY_DIMENSION = 1;
export const MAX_RUNE_ARRAY_DIMENSION = 15;
export const DEFAULT_RUNE_ARRAY_DIMENSION = 5;
export const MAX_RUNE_ARRAY_DESCRIPTION_LENGTH = 200;
/** Deepest chain of arrays inside arrays a board may contain, counting the root as depth 0. */
export const MAX_RUNE_ARRAY_DEPTH = 8;

export function isRuneArrayDimension(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MIN_RUNE_ARRAY_DIMENSION &&
    value <= MAX_RUNE_ARRAY_DIMENSION &&
    value % 2 === 1
  );
}

export function requireRuneArrayDimension(value: number, label: string): void {
  if (!isRuneArrayDimension(value)) {
    throw new RangeError(
      `${label} must be an odd integer from ${MIN_RUNE_ARRAY_DIMENSION} through ` +
      `${MAX_RUNE_ARRAY_DIMENSION}`,
    );
  }
}

export function validateRuneArrayDescription(description: string): void {
  if (
    typeof description !== "string" ||
    description.length > MAX_RUNE_ARRAY_DESCRIPTION_LENGTH
  ) {
    throw new RangeError(
      `Rune array description must be a string of at most ` +
      `${MAX_RUNE_ARRAY_DESCRIPTION_LENGTH} characters`,
    );
  }
  for (const character of description) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint < 0x20 && codePoint !== 0x0a) || codePoint === 0x7f) {
      throw new RangeError("Rune array description must not contain control characters");
    }
  }
}

/** Cell index inside a `width` × `height` array board that is wired to the outer `side`. */
export function runeArrayPortCellIndex(
  width: number,
  height: number,
  side: Direction,
): number {
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  switch (side) {
    case Direction.Up:
      return centerX;
    case Direction.Right:
      return centerY * width + width - 1;
    case Direction.Down:
      return (height - 1) * width + centerX;
    case Direction.Left:
      return centerY * width;
    default:
      throw new RangeError(`Invalid rune array side ${side as number}`);
  }
}

/**
 * Remaps four per-side port charges through the same flip-then-rotate transform
 * applied to tile orientations, so a rotated array keeps each signal on the side
 * that its rotated contents now face.
 */
export function transformRuneArrayPorts(
  ports: ArrayLike<number>,
  quarterTurns: number,
  flippedHorizontally: boolean,
  flippedVertically: boolean,
): Charge[] {
  if (ports.length !== 4) {
    throw new RangeError("Rune array ports must hold exactly four charges");
  }
  const result: Charge[] = [0, 0, 0, 0];
  for (let value = Direction.Up; value <= Direction.Left; value += 1) {
    let side = value as Direction;
    if (flippedHorizontally) {
      side = flipDirectionHorizontally(side);
    }
    if (flippedVertically) {
      side = flipDirectionVertically(side);
    }
    side = ((side + quarterTurns) & 3) as Direction;
    result[side] = ports[value] as Charge;
  }
  return result;
}
