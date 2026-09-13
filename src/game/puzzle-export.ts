import type { GridRegion } from "./grid-region";
import { PUZZLE_FORMAT, PUZZLE_VERSION } from "./puzzle-format";
import { serializeBoard } from "../simulation/board-export";
import { TILE_DEFINITIONS, type TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";
import type { TextBox } from "../simulation/text-box";
import type { PuzzleDifficulty } from "./puzzle-difficulty";

interface PuzzleTemplateComponent {
  readonly code: string;
  readonly price: number;
  readonly order: number;
}

export interface PuzzleExportMetadata {
  readonly id: string;
  readonly groupId: string;
  readonly order: number;
  readonly name: string;
  readonly difficulty: PuzzleDifficulty;
  readonly description: string;
  readonly goal: string;
  readonly cycleLimit: number | null;
  readonly components: readonly { readonly kind: TileKind; readonly price: number }[];
  readonly testCases: readonly unknown[];
}

function componentEntries(
  components: PuzzleExportMetadata["components"],
): readonly { readonly code: string; readonly price: number }[] {
  const entries: PuzzleTemplateComponent[] = components.map(({ kind, price }) => {
    const definition = TILE_DEFINITIONS[kind];
    if (definition === undefined || definition.palette === null) {
      throw new Error(`Tile kind ${kind} cannot be exported as a puzzle component`);
    }
    return {
      code: definition.boardCode,
      price,
      order: definition.palette.order,
    };
  });
  entries.sort((left, right) => left.order - right.order);
  return entries.map(({ code, price }) => ({ code, price }));
}

function placeholderMetadata(): PuzzleExportMetadata {
  return {
    id: "untitled-puzzle",
    groupId: "basics",
    order: 0,
    name: "Untitled Puzzle",
    difficulty: 1,
    description: "TODO: Describe the puzzle setup.",
    goal: "TODO: Describe the victory condition.",
    cycleLimit: null,
    components: [],
    testCases: [],
  };
}

export function serializePuzzleTemplate(
  world: World,
  editableRegion: GridRegion,
  metadata: PuzzleExportMetadata = placeholderMetadata(),
): string {
  if (!editableRegion.fitsWithin(world.width, world.height)) {
    throw new RangeError("Puzzle editable regions must fit within the exported board");
  }
  const initialWorld = world.clone();
  initialWorld.resetPuzzleResult();
  const initialBoard = JSON.parse(serializeBoard(initialWorld, 0)) as unknown;
  const puzzle = {
    format: PUZZLE_FORMAT,
    version: PUZZLE_VERSION,
    width: world.width,
    height: world.height,
    id: metadata.id,
    group: metadata.groupId,
    order: metadata.order,
    name: metadata.name,
    difficulty: metadata.difficulty,
    description: metadata.description,
    goal: metadata.goal,
    ...(metadata.cycleLimit === null ? {} : { cycleLimit: metadata.cycleLimit }),
    components: componentEntries(metadata.components),
    editableRegions: editableRegion.rectangles,
    initialBoard,
    testCases: metadata.testCases,
  };
  // The same rule applies to base, nested, and additional-case boards. JSON traversal
  // leaves the live scene and caller-owned override payloads untouched.
  return `${JSON.stringify(puzzle, (key: string, value: unknown): unknown => {
    if (key === "textBoxes" && Array.isArray(value)) {
      return (value as readonly TextBox[]).map((box) => ({ ...box, owner: "author" }));
    }
    return value;
  }, 2)}\n`;
}
