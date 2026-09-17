import { expectDefined } from "../util/assert";
import { MAX_ASSEMBLER_OUTPUTS, type AssemblerOutput } from "./configurable-components";
import {
  Direction,
  mirroringForKind,
  orientedDirection,
  orientationForKind,
  TILE_DEFINITIONS,
  tileKindForBoardCode,
  TileKind,
} from "./tile";

export type { AssemblerOutput };

/**
 * One assembler recipe. `input` rows use compact board codes (`.` for empty) and `welds`
 * rows use board weld codes (`.`, `-`, `|`, `+`) for each cell's right and down welds.
 * Every input cell faces up and all input cells must form one welded body. Output
 * orientations and handedness are relative to this untransformed input; a rotated or
 * reflected input produces outputs transformed the same way.
 */
export interface AssemblerRecipe {
  readonly name: string;
  readonly input: readonly string[];
  readonly welds: readonly string[];
  readonly outputs: readonly AssemblerOutput[];
}

export const ASSEMBLER_RECIPES: readonly AssemblerRecipe[] = Object.freeze([
  Object.freeze({
    name: "Sensor pair",
    input: ["Gi"],
    welds: ["-."],
    outputs: [
      { kind: TileKind.Sensor, orientation: Direction.Up },
      { kind: TileKind.Sensor, orientation: Direction.Up },
    ],
  }),
  Object.freeze({
    name: "Piston",
    input: ["i", "#"],
    welds: ["|", "."],
    outputs: [{ kind: TileKind.Piston, orientation: Direction.Up }],
  }),
  Object.freeze({
    name: "Lodestone",
    input: ["i.", "ii"],
    welds: ["|.", "-."],
    outputs: [{ kind: TileKind.Magnet, orientation: Direction.Right }],
  }),
  Object.freeze({
    name: "Conduits",
    input: ["ii", "ii"],
    welds: ["+|", "-."],
    outputs: [
      { kind: TileKind.Conduit, orientation: Direction.Up },
      { kind: TileKind.Conduit, orientation: Direction.Up },
      { kind: TileKind.Conduit, orientation: Direction.Up },
      { kind: TileKind.Conduit, orientation: Direction.Up },
    ],
  }),
]);

/** One input cell of a rotated recipe, relative to the pattern's top-left occupied bound. */
export interface AssemblerPatternCell {
  readonly dx: number;
  readonly dy: number;
  readonly kind: TileKind;
  readonly orientation: Direction;
  readonly mirrored: boolean;
  readonly rightWeld: boolean;
  readonly downWeld: boolean;
}

/** One rotation of a recipe with its outputs rotated to match. */
export interface AssemblerPattern {
  readonly recipe: AssemblerRecipe;
  /** Clockwise quarter turns applied to the recipe input. */
  readonly rotation: number;
  readonly cells: readonly AssemblerPatternCell[];
  readonly outputs: readonly AssemblerOutput[];
}

interface MutablePatternCell {
  x: number;
  y: number;
  kind: TileKind;
  orientation: Direction;
  mirrored: boolean;
  rightWeld: boolean;
  downWeld: boolean;
}

function parseRecipeCells(recipe: AssemblerRecipe): MutablePatternCell[] {
  const height = recipe.input.length;
  const width = expectDefined(recipe.input[0], `${recipe.name} input row`).length;
  if (height === 0 || width === 0 || recipe.welds.length !== height) {
    throw new Error(`Assembler recipe "${recipe.name}" has malformed input rows`);
  }
  const cells: MutablePatternCell[] = [];
  const cellAt = (x: number, y: number): MutablePatternCell | undefined =>
    cells.find((cell) => cell.x === x && cell.y === y);
  for (let y = 0; y < height; y += 1) {
    const row = expectDefined(recipe.input[y], `${recipe.name} input row`);
    if (row.length !== width) {
      throw new Error(`Assembler recipe "${recipe.name}" input row ${y} has the wrong width`);
    }
    for (let x = 0; x < width; x += 1) {
      const code = expectDefined(row[x], `${recipe.name} input code`);
      const kind = tileKindForBoardCode(code);
      if (kind === undefined) {
        throw new Error(`Assembler recipe "${recipe.name}" uses unknown tile code "${code}"`);
      }
      if (kind !== TileKind.Empty) {
        cells.push({
          x, y, kind, orientation: Direction.Up, mirrored: false, rightWeld: false, downWeld: false,
        });
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    const row = expectDefined(recipe.welds[y], `${recipe.name} weld row`);
    if (row.length !== width) {
      throw new Error(`Assembler recipe "${recipe.name}" weld row ${y} has the wrong width`);
    }
    for (let x = 0; x < width; x += 1) {
      const code = expectDefined(row[x], `${recipe.name} weld code`);
      const right = code === "-" || code === "+";
      const down = code === "|" || code === "+";
      if (!right && !down && code !== ".") {
        throw new Error(`Assembler recipe "${recipe.name}" uses unknown weld code "${code}"`);
      }
      if (!right && !down) {
        continue;
      }
      const cell = cellAt(x, y);
      if (
        cell === undefined ||
        (right && cellAt(x + 1, y) === undefined) ||
        (down && cellAt(x, y + 1) === undefined)
      ) {
        throw new Error(`Assembler recipe "${recipe.name}" welds an empty cell at (${x}, ${y})`);
      }
      cell.rightWeld = right;
      cell.downWeld = down;
    }
  }
  return cells;
}

function requireSingleWeldedBody(cells: readonly MutablePatternCell[], recipe: AssemblerRecipe): void {
  if (cells.length === 0) {
    throw new Error(`Assembler recipe "${recipe.name}" has no input cells`);
  }
  const visited = new Set<MutablePatternCell>();
  const stack = [expectDefined(cells[0], "first recipe cell")];
  visited.add(expectDefined(cells[0], "first recipe cell"));
  while (stack.length > 0) {
    const cell = expectDefined(stack.pop(), "recipe flood-fill cell");
    for (const other of cells) {
      const welded =
        (cell.rightWeld && other.x === cell.x + 1 && other.y === cell.y) ||
        (cell.downWeld && other.x === cell.x && other.y === cell.y + 1) ||
        (other.rightWeld && cell.x === other.x + 1 && cell.y === other.y) ||
        (other.downWeld && cell.x === other.x && cell.y === other.y + 1);
      if (welded && !visited.has(other)) {
        visited.add(other);
        stack.push(other);
      }
    }
  }
  if (visited.size !== cells.length) {
    throw new Error(`Assembler recipe "${recipe.name}" input is not one welded body`);
  }
}

/** Rotates cells one quarter turn clockwise about the origin of a `width` x `height` grid. */
function rotateCellsClockwise(
  cells: readonly MutablePatternCell[],
  height: number,
): MutablePatternCell[] {
  const rotated = cells.map((cell) => ({
    x: height - 1 - cell.y,
    y: cell.x,
    kind: cell.kind,
    orientation: orientationForKind(cell.kind, ((cell.orientation + 1) & 3) as Direction),
    mirrored: cell.mirrored,
    rightWeld: false,
    downWeld: false,
  }));
  for (let index = 0; index < cells.length; index += 1) {
    const source = expectDefined(cells[index], "rotated source cell");
    const target = expectDefined(rotated[index], "rotated target cell");
    if (source.rightWeld) {
      // The edge to the right neighbor becomes the edge to the neighbor below.
      target.downWeld = true;
    }
    if (source.downWeld) {
      // The edge to the neighbor below becomes the edge from the neighbor to the left.
      const left = rotated.find((cell) => cell.x === target.x - 1 && cell.y === target.y);
      expectDefined(left, "rotated left weld neighbor").rightWeld = true;
    }
  }
  return rotated;
}

/** Reflect the recipe across its vertical axis, including edge ownership and chirality. */
function reflectCells(cells: readonly MutablePatternCell[], width: number): MutablePatternCell[] {
  const reflected = cells.map((cell) => ({
    x: width - 1 - cell.x,
    y: cell.y,
    kind: cell.kind,
    orientation: orientationForKind(
      cell.kind, orientedDirection(cell.orientation, Direction.Up, true),
    ),
    mirrored: mirroringForKind(cell.kind, !cell.mirrored),
    rightWeld: false,
    downWeld: cell.downWeld,
  }));
  for (let index = 0; index < cells.length; index += 1) {
    const source = expectDefined(cells[index], "reflected source cell");
    if (source.rightWeld) {
      const target = expectDefined(reflected[index], "reflected target cell");
      const left = reflected.find((cell) => cell.x === target.x - 1 && cell.y === target.y);
      expectDefined(left, "reflected left weld neighbor").rightWeld = true;
    }
  }
  return reflected;
}

function normalizedCells(cells: readonly MutablePatternCell[]): AssemblerPatternCell[] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
  }
  return cells
    .map((cell) => Object.freeze({
      dx: cell.x - minX,
      dy: cell.y - minY,
      kind: cell.kind,
      orientation: cell.orientation,
      mirrored: cell.mirrored,
      rightWeld: cell.rightWeld,
      downWeld: cell.downWeld,
    }))
    .sort((first, second) => first.dy - second.dy || first.dx - second.dx);
}

function patternKey(cells: readonly AssemblerPatternCell[]): string {
  return cells
    .map((cell) =>
      `${cell.dx},${cell.dy},${cell.kind},${cell.orientation},${cell.mirrored ? 1 : 0},` +
      `${cell.rightWeld ? 1 : 0}${cell.downWeld ? 1 : 0}`)
    .join(";");
}

function buildPatterns(recipes: readonly AssemblerRecipe[], mirrored: boolean): AssemblerPattern[] {
  const patterns: AssemblerPattern[] = [];
  const recipeByKey = new Map<string, AssemblerRecipe>();
  for (const recipe of recipes) {
    if (recipe.outputs.length < 1 || recipe.outputs.length > MAX_ASSEMBLER_OUTPUTS) {
      throw new Error(
        `Assembler recipe "${recipe.name}" must emit 1 through ${MAX_ASSEMBLER_OUTPUTS} outputs`,
      );
    }
    for (const output of recipe.outputs) {
      if (output.kind === TileKind.Empty || TILE_DEFINITIONS[output.kind] === undefined) {
        throw new Error(`Assembler recipe "${recipe.name}" emits an invalid tile kind`);
      }
    }
    let cells = parseRecipeCells(recipe);
    requireSingleWeldedBody(cells, recipe);
    let height = recipe.input.length;
    let width = expectDefined(recipe.input[0], `${recipe.name} input row`).length;
    if (mirrored) {
      cells = reflectCells(cells, width);
    }
    for (let rotation = 0; rotation < 4; rotation += 1) {
      if (rotation > 0) {
        cells = rotateCellsClockwise(cells, height);
        const previousHeight = height;
        height = width;
        width = previousHeight;
      }
      const normalized = normalizedCells(cells);
      const key = patternKey(normalized);
      const existing = recipeByKey.get(key);
      if (existing === recipe) {
        continue;
      }
      if (existing !== undefined) {
        throw new Error(
          `Assembler recipes "${existing.name}" and "${recipe.name}" share a rotated input`,
        );
      }
      recipeByKey.set(key, recipe);
      patterns.push(Object.freeze({
        recipe,
        rotation,
        cells: Object.freeze(normalized),
        outputs: Object.freeze(recipe.outputs.map((output) => Object.freeze({
          kind: output.kind,
          orientation: orientationForKind(
            output.kind,
            orientedDirection(output.orientation, rotation as Direction, mirrored),
          ),
          ...(mirroringForKind(output.kind, (output.mirrored ?? false) !== mirrored)
            ? { mirrored: true }
            : {}),
        }))),
      }));
    }
  }
  return patterns;
}

/**
 * Every distinct rotation of every recipe input, in recipe order then by rotation.
 * A body is matched against these in order, so symmetric inputs resolve to the lowest
 * rotation and the output orientation is deterministic.
 */
export const ASSEMBLER_PATTERNS: readonly AssemblerPattern[] = Object.freeze(
  buildPatterns(ASSEMBLER_RECIPES, false),
);

/** Reflected recipe inputs and products, in the same deterministic rotation order. */
export const MIRRORED_ASSEMBLER_PATTERNS: readonly AssemblerPattern[] = Object.freeze(
  buildPatterns(ASSEMBLER_RECIPES, true),
);
