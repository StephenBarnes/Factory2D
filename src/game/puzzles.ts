import type { GridRegion } from "./grid-region";
import { parsePuzzleFile, type ParsedPuzzleFile } from "./puzzle-format";
import {
  puzzleGroupById,
  type PuzzleGroupDefinition,
} from "./puzzle-groups";
import type { PuzzleComponents } from "./puzzle-components";
import { TileKind } from "../simulation/tile";
import { World } from "../simulation/world";
import { expectDefined } from "../util/assert";
import type { PuzzleDifficulty } from "./puzzle-difficulty";

export type PuzzleId = string;

export interface PuzzleTestCaseDefinition {
  readonly id: string;
  readonly name: string;
  readonly cycleLimit: number;
  readonly createInitialWorld: () => World;
}

export interface PuzzleDefinition {
  readonly id: PuzzleId;
  readonly groupId: string;
  readonly order: number;
  readonly name: string;
  readonly difficulty: PuzzleDifficulty;
  readonly cycleLimit: number;
  readonly description: string;
  readonly goal: string;
  readonly editableRegion: GridRegion;
  readonly availableComponents: PuzzleComponents;
  readonly createInitialWorld: () => World;
  readonly testCases: readonly PuzzleTestCaseDefinition[];
}

function addFloor(world: World): void {
  for (let x = 0; x < world.width; x += 1) {
    world.place(x, world.height - 1, TileKind.Platform);
  }
}


export function createSandboxWorld(): World {
  const world = new World(20, 14);
  addFloor(world);
  for (let x = 3; x <= 7; x += 1) {
    world.place(x, 9, TileKind.Platform);
  }
  for (let x = 13; x <= 16; x += 1) {
    world.place(x, 11, TileKind.Platform);
  }
  world.place(5, 3, TileKind.Sand);
  world.place(5, 4, TileKind.Sand);
  world.place(11, 2, TileKind.Sand);
  world.place(15, 5, TileKind.Sand);
  return world;
}

interface LoadedPuzzle {
  readonly sourcePath: string;
  readonly parsed: ParsedPuzzleFile;
}

const PUZZLE_FILE_MODULES: Readonly<Record<string, unknown>> =
  typeof process === "undefined"
    ? import.meta.glob<unknown>("./puzzles/*.json", {
        eager: true,
        import: "default",
      })
    : loadNodePuzzleFiles();

function loadNodePuzzleFiles(): Readonly<Record<string, unknown>> {
  const fileSystem = process.getBuiltinModule("node:fs");
  const puzzleDirectory = "./puzzles/";
  const directoryUrl = new URL(puzzleDirectory, import.meta.url);
  const files: Record<string, unknown> = Object.create(null);
  for (const fileName of fileSystem.readdirSync(directoryUrl)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const sourcePath = `./puzzles/${fileName}`;
    const source = fileSystem.readFileSync(new URL(fileName, directoryUrl), "utf8");
    try {
      files[sourcePath] = JSON.parse(source) as unknown;
    } catch {
      throw new Error(`${sourcePath}: file is not valid JSON`);
    }
  }
  return files;
}

export const PUZZLES = loadPuzzleDefinitions(PUZZLE_FILE_MODULES);

export function loadPuzzleDefinitions(
  files: Readonly<Record<string, unknown>>,
): readonly PuzzleDefinition[] {
  const loadedPuzzles: LoadedPuzzle[] = [];
  const loadedById: Record<string, LoadedPuzzle | undefined> = Object.create(null);

  for (const [sourcePath, value] of Object.entries(files)) {
    const parsed = parsePuzzleFile(value, sourcePath);
    const fileName = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
    if (fileName !== `${parsed.id}.json`) {
      throw new Error(
        `${sourcePath}: file name must match puzzle id "${parsed.id}.json"`,
      );
    }
    const existingId = loadedById[parsed.id];
    if (existingId !== undefined) {
      throw new Error(
        `${sourcePath}: puzzle id "${parsed.id}" is already defined by ${existingId.sourcePath}`,
      );
    }
    const loaded = { sourcePath, parsed };
    loadedPuzzles.push(loaded);
    loadedById[parsed.id] = loaded;
  }

  if (loadedPuzzles.length === 0) {
    throw new Error("At least one shipped puzzle JSON file is required");
  }
  for (const loaded of loadedPuzzles) {
    if (puzzleGroupById(loaded.parsed.groupId) === undefined) {
      throw new Error(
        `${loaded.sourcePath}: puzzle group "${loaded.parsed.groupId}" is not defined`,
      );
    }
  }

  loadedPuzzles.sort((left, right) => {
    const leftGroup = expectDefined(
      puzzleGroupById(left.parsed.groupId),
      `Missing validated puzzle group "${left.parsed.groupId}"`,
    );
    const rightGroup = expectDefined(
      puzzleGroupById(right.parsed.groupId),
      `Missing validated puzzle group "${right.parsed.groupId}"`,
    );
    return leftGroup.displayOrder - rightGroup.displayOrder ||
      left.parsed.order - right.parsed.order ||
      left.parsed.id.localeCompare(right.parsed.id);
  });
  return Object.freeze(loadedPuzzles.map(({ parsed }) => Object.freeze({
    id: parsed.id,
    groupId: parsed.groupId,
    order: parsed.order,
    name: parsed.name,
    difficulty: parsed.difficulty,
    cycleLimit: parsed.cycleLimit,
    description: parsed.description,
    goal: parsed.goal,
    editableRegion: parsed.editableRegion,
    availableComponents: parsed.availableComponents,
    createInitialWorld: () => parsed.initialWorld.clone(),
    testCases: Object.freeze(
      parsed.testCases.map((testCase) =>
        Object.freeze({
          id: testCase.id,
          name: testCase.name,
          cycleLimit: testCase.cycleLimit,
          createInitialWorld: () => testCase.initialWorld.clone(),
        }),
      ),
    ),
  })));
}


const puzzlesById: Record<string, PuzzleDefinition | undefined> = Object.create(null);
for (const puzzle of PUZZLES) {
  puzzlesById[puzzle.id] = puzzle;
}
const PUZZLES_BY_ID = Object.freeze(puzzlesById);

export function puzzleById(id: PuzzleId): PuzzleDefinition {
  return expectDefined(PUZZLES_BY_ID[id], `Unknown puzzle id "${id}"`);
}

/** Export the authored file, never a solution or a running test world. */
export function serializeShippedPuzzle(id: PuzzleId): string {
  const puzzle = puzzleById(id);
  const source = expectDefined(
    PUZZLE_FILE_MODULES[`./puzzles/${puzzle.id}.json`],
    `Missing shipped puzzle file "${puzzle.id}"`,
  );
  return JSON.stringify(source, null, 2);
}

export function isPuzzleGroupUnlocked(
  group: PuzzleGroupDefinition,
  completedPuzzleIds: ReadonlySet<PuzzleId>,
): boolean {
  return completedPuzzleIds.size >= group.gemstoneThreshold;
}

export function isPuzzleUnlocked(
  puzzle: PuzzleDefinition,
  completedPuzzleIds: ReadonlySet<PuzzleId>,
  puzzles: readonly PuzzleDefinition[] = PUZZLES,
): boolean {
  if (completedPuzzleIds.has(puzzle.id)) {
    return true;
  }
  const group = expectDefined(
    puzzleGroupById(puzzle.groupId),
    `Unknown puzzle group "${puzzle.groupId}"`,
  );
  if (!isPuzzleGroupUnlocked(group, completedPuzzleIds)) {
    return false;
  }

  let puzzleIndex = -1;
  let groupPuzzleCount = 0;
  let completedInGroup = 0;
  for (const candidate of puzzles) {
    if (candidate.groupId !== puzzle.groupId) {
      continue;
    }
    if (candidate.id === puzzle.id) {
      puzzleIndex = groupPuzzleCount;
    }
    if (completedPuzzleIds.has(candidate.id)) {
      completedInGroup += 1;
    }
    groupPuzzleCount += 1;
  }
  if (puzzleIndex < 0) {
    throw new Error(`Puzzle "${puzzle.id}" is missing from its progression list`);
  }
  return puzzleIndex < group.initialUnlockedPuzzleCount + completedInGroup;
}
