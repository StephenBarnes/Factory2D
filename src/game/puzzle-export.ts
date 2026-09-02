import type { GridRegion } from "./grid-region";
import { PUZZLE_FORMAT, PUZZLE_VERSION } from "./puzzle-format";
import { serializeBoard } from "../simulation/board-export";
import { TILE_DEFINITIONS, TILE_KINDS, type TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";

const PLACEHOLDER_COMPONENT_PRICE = 1;

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
  readonly description: string;
  readonly goal: string;
  readonly features: readonly string[];
  readonly cycleLimit: number | null;
  readonly components: readonly { readonly kind: TileKind; readonly price: number }[];
  readonly testCases: readonly unknown[];
}

export function placeholderPuzzleComponents(): readonly {
  readonly kind: TileKind;
  readonly price: number;
}[] {
  const components: { kind: TileKind; price: number; order: number }[] = [];
  for (const kind of TILE_KINDS) {
    const definition = TILE_DEFINITIONS[kind];
    if (definition.palette !== null) {
      components.push({
        kind,
        price: PLACEHOLDER_COMPONENT_PRICE,
        order: definition.palette.order,
      });
    }
  }
  components.sort((left, right) => left.order - right.order);
  return components.map(({ kind, price }) => ({ kind, price }));
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
    description: "TODO: Describe the puzzle setup.",
    goal: "TODO: Describe the victory condition.",
    features: [],
    cycleLimit: null,
    components: placeholderPuzzleComponents(),
    testCases: [
      {
        id: "standard",
        name: "Standard case",
        overrides: {},
      },
    ],
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
    description: metadata.description,
    goal: metadata.goal,
    features: metadata.features,
    ...(metadata.cycleLimit === null ? {} : { cycleLimit: metadata.cycleLimit }),
    components: componentEntries(metadata.components),
    editableRegions: editableRegion.rectangles,
    initialBoard,
    testCases: metadata.testCases,
  };
  return `${JSON.stringify(puzzle, null, 2)}\n`;
}
