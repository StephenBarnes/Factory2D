import type { Page } from "@playwright/test";
import {
  PUZZLE_PROGRESS_STORAGE_KEY,
  saveCompletedPuzzleIds,
} from "../src/game/puzzle-progress";
import {
  PUZZLE_SOLUTIONS_STORAGE_KEY,
  PuzzleSolutions,
} from "../src/game/puzzle-solutions";
import { puzzleById, type PuzzleId } from "../src/game/puzzles";
import { serializeBoard } from "../src/simulation/board-export";
import { TileKind } from "../src/simulation/tile";

export type BrowserStorageFixtureName =
  | "empty"
  | "populated"
  | "unlocked"
  | "edited-board"
  | "malformed-storage";

export interface BrowserStorageFixture {
  readonly values: Readonly<Record<string, string>>;
  readonly solutionIds: readonly string[];
  readonly editedBoard: string | null;
}

function progressValue(completedPuzzleIds: ReadonlySet<PuzzleId>): string {
  let serialized: string | null = null;
  saveCompletedPuzzleIds(
    {
      getItem: () => serialized,
      setItem: (_key, value) => {
        serialized = value;
      },
    },
    completedPuzzleIds,
  );
  if (serialized === null) {
    throw new Error("Puzzle progress serializer did not write a value");
  }
  return serialized;
}

function populatedSolutions(): PuzzleSolutions {
  const puzzle = puzzleById("first-shift");
  const solutions = PuzzleSolutions.empty();
  const board = serializeBoard(puzzle.createInitialWorld(), 0);
  solutions.create(puzzle.id, board);
  solutions.create(puzzle.id, board);
  return solutions;
}

export function browserStorageFixture(
  name: BrowserStorageFixtureName,
): BrowserStorageFixture {
  if (name === "empty") {
    return { values: {}, solutionIds: [], editedBoard: null };
  }

  if (name === "populated") {
    const solutions = populatedSolutions();
    return {
      values: { [PUZZLE_SOLUTIONS_STORAGE_KEY]: solutions.serialize() },
      solutionIds: ["solution-1", "solution-2"],
      editedBoard: null,
    };
  }

  if (name === "unlocked") {
    return {
      values: {
        [PUZZLE_PROGRESS_STORAGE_KEY]: progressValue(new Set<PuzzleId>(["sand-fall"])),
      },
      solutionIds: [],
      editedBoard: null,
    };
  }

  if (name === "edited-board") {
    const puzzle = puzzleById("first-shift");
    const world = puzzle.createInitialWorld();
    world.place(8, 3, TileKind.Stone);
    const board = serializeBoard(world, 0);
    const solutions = PuzzleSolutions.empty();
    const solution = solutions.create(puzzle.id, board);
    return {
      values: { [PUZZLE_SOLUTIONS_STORAGE_KEY]: solutions.serialize() },
      solutionIds: [solution.id],
      editedBoard: board,
    };
  }

  return {
    values: {
      [PUZZLE_PROGRESS_STORAGE_KEY]: "{not valid JSON",
      [PUZZLE_SOLUTIONS_STORAGE_KEY]: JSON.stringify({ version: 999, solutions: [] }),
    },
    solutionIds: [],
    editedBoard: null,
  };
}

export async function seedBrowserStorage(
  page: Page,
  name: BrowserStorageFixtureName,
): Promise<BrowserStorageFixture> {
  const fixture = browserStorageFixture(name);
  await page.addInitScript((values: Record<string, string>) => {
    const seedMarker = "factory2d.browser-fixture-seeded";
    if (window.sessionStorage.getItem(seedMarker) !== null) {
      return;
    }
    window.localStorage.clear();
    for (const [key, value] of Object.entries(values)) {
      window.localStorage.setItem(key, value);
    }
    window.sessionStorage.setItem(seedMarker, "true");
  }, fixture.values);
  return fixture;
}
