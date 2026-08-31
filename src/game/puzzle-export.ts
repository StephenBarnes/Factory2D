import type { GridRegion } from "./grid-region";
import { PUZZLE_FORMAT, PUZZLE_VERSION } from "./puzzle-format";
import { serializeBoard } from "../simulation/board-export";
import { TILE_DEFINITIONS, TILE_KINDS } from "../simulation/tile";
import type { World } from "../simulation/world";

const PLACEHOLDER_COMPONENT_PRICE = 1;

interface PuzzleTemplateComponent {
  readonly code: string;
  readonly price: number;
  readonly order: number;
}

function placeholderComponents(): readonly { readonly code: string; readonly price: number }[] {
  const components: PuzzleTemplateComponent[] = [];
  for (const kind of TILE_KINDS) {
    const definition = TILE_DEFINITIONS[kind];
    if (definition.palette !== null) {
      components.push({
        code: definition.boardCode,
        price: PLACEHOLDER_COMPONENT_PRICE,
        order: definition.palette.order,
      });
    }
  }
  components.sort((left, right) => left.order - right.order);
  return components.map(({ code, price }) => ({ code, price }));
}

export function serializePuzzleTemplate(world: World, editableRegion: GridRegion): string {
  if (!editableRegion.fitsWithin(world.width, world.height)) {
    throw new RangeError("Puzzle editable regions must fit within the exported board");
  }
  const initialWorld = world.clone();
  initialWorld.resetPuzzleResult();
  const initialBoard = JSON.parse(serializeBoard(initialWorld, 0)) as unknown;
  const puzzle = {
    format: PUZZLE_FORMAT,
    version: PUZZLE_VERSION,
    id: "untitled-puzzle",
    order: 0,
    name: "Untitled Puzzle",
    description: "TODO: Describe the puzzle setup.",
    goal: "TODO: Describe the victory condition.",
    features: [],
    prerequisites: [],
    components: placeholderComponents(),
    editableRegions: editableRegion.rectangles,
    initialBoard,
    testCases: [
      {
        id: "standard",
        name: "Standard case",
        overrides: {},
      },
    ],
  };
  return `${JSON.stringify(puzzle, null, 2)}\n`;
}
