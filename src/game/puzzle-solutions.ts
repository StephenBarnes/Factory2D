import { puzzleById, PUZZLES, type PuzzleId } from "./puzzles";
import { deserializeBoard } from "../simulation/board-export";
import { PuzzleResult } from "../simulation/puzzle-result";
import { parsePuzzleScores, type PuzzleScores } from "./puzzle-scores";

export const PUZZLE_SOLUTIONS_STORAGE_KEY = "factory2d.puzzle-solutions";
const PUZZLE_SOLUTIONS_VERSION = 2;
// Invalidate obsolete scores independently of saved designs and puzzle progression.
const PUZZLE_SCORING_VERSION = 1;

type PuzzleSolutionsStorage = Pick<Storage, "getItem" | "setItem">;

export interface SavedPuzzleSolution {
  readonly id: string;
  readonly puzzleId: PuzzleId;
  readonly name: string;
  readonly board: string;
  readonly scores: PuzzleScores | null;
}

interface StoredPuzzleSolutions {
  readonly version: typeof PUZZLE_SOLUTIONS_VERSION;
  readonly scoringVersion: typeof PUZZLE_SCORING_VERSION;
  readonly nextSolutionId: number;
  readonly solutions: readonly SavedPuzzleSolution[];
}

export class PuzzleSolutions {
  private constructor(
    private readonly solutions: SavedPuzzleSolution[],
    private nextSolutionId: number,
  ) {}

  static empty(): PuzzleSolutions {
    return new PuzzleSolutions([], 1);
  }

  static deserialize(serialized: string): PuzzleSolutions {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error("Stored puzzle solutions are not valid JSON");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Stored puzzle solutions must be an object");
    }

    const record = value as Record<string, unknown>;
    if (record.version !== PUZZLE_SOLUTIONS_VERSION) {
      throw new Error("Stored puzzle solutions have an unsupported version");
    }
    if (!Number.isSafeInteger(record.nextSolutionId) || (record.nextSolutionId as number) < 1) {
      throw new Error("Stored next solution ID must be a positive integer");
    }
    if (!Array.isArray(record.solutions)) {
      throw new Error("Stored puzzle solutions must be an array");
    }

    const seenIds = new Set<string>();
    const solutions = record.solutions.map((entry, index) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Error(`Stored puzzle solution at index ${index} must be an object`);
      }
      const solution = entry as Record<string, unknown>;
      if (typeof solution.id !== "string" || solution.id.length === 0) {
        throw new Error(`Stored puzzle solution at index ${index} has an invalid ID`);
      }
      if (seenIds.has(solution.id)) {
        throw new Error(`Stored puzzle solution ID ${solution.id} is duplicated`);
      }
      seenIds.add(solution.id);

      const puzzle = PUZZLES.find((candidate) => candidate.id === solution.puzzleId);
      if (puzzle === undefined) {
        throw new Error(`Stored puzzle solution at index ${index} has an invalid puzzle ID`);
      }
      if (typeof solution.name !== "string" || solution.name.trim().length === 0) {
        throw new Error(`Stored puzzle solution at index ${index} has an invalid name`);
      }
      if (typeof solution.board !== "string") {
        throw new Error(`Stored puzzle solution at index ${index} has an invalid board`);
      }

      const imported = deserializeBoard(solution.board);
      const initialWorld = puzzle.createInitialWorld();
      if (imported.world.width !== initialWorld.width || imported.world.height !== initialWorld.height) {
        throw new Error(`Stored puzzle solution at index ${index} has incorrect dimensions`);
      }
      if (imported.tick !== 0 || imported.world.puzzleResult !== PuzzleResult.InProgress) {
        throw new Error(`Stored puzzle solution at index ${index} is not an editable baseline`);
      }

      const scores = solution.scores === null
        ? null
        : parsePuzzleScores(solution.scores, `Stored puzzle solution at index ${index}`);

      return {
        id: solution.id,
        puzzleId: puzzle.id,
        name: solution.name,
        board: solution.board,
        scores: record.scoringVersion === PUZZLE_SCORING_VERSION ? scores : null,
      };
    });

    return new PuzzleSolutions(solutions, record.nextSolutionId as number);
  }

  forPuzzle(puzzleId: PuzzleId): readonly SavedPuzzleSolution[] {
    return this.solutions.filter((solution) => solution.puzzleId === puzzleId);
  }

  findById(id: string): SavedPuzzleSolution | undefined {
    return this.solutions.find((candidate) => candidate.id === id);
  }

  byId(id: string): SavedPuzzleSolution {
    const solution = this.findById(id);
    if (solution === undefined) {
      throw new Error(`Unknown puzzle solution ${id}`);
    }
    return solution;
  }

  create(puzzleId: PuzzleId, board: string): SavedPuzzleSolution {
    puzzleById(puzzleId);
    const usedNames = new Set(this.forPuzzle(puzzleId).map((solution) => solution.name));
    let nameNumber = 1;
    while (usedNames.has(`Solution ${nameNumber}`)) {
      nameNumber += 1;
    }

    let id = `solution-${this.nextSolutionId}`;
    while (this.solutions.some((solution) => solution.id === id)) {
      this.nextSolutionId += 1;
      id = `solution-${this.nextSolutionId}`;
    }
    this.nextSolutionId += 1;

    const solution: SavedPuzzleSolution = {
      id,
      puzzleId,
      name: `Solution ${nameNumber}`,
      board,
      scores: null,
    };
    this.solutions.push(solution);
    return solution;
  }

  duplicate(id: string): SavedPuzzleSolution {
    const source = this.byId(id);
    const usedNames = new Set(this.forPuzzle(source.puzzleId).map((solution) => solution.name));
    const baseName = `${source.name} Copy`;
    let name = baseName;
    let copyNumber = 2;
    while (usedNames.has(name)) {
      name = `${baseName} ${copyNumber}`;
      copyNumber += 1;
    }

    const duplicate = this.create(source.puzzleId, source.board);
    const renamedDuplicate = { ...duplicate, name, scores: source.scores };
    this.solutions[this.solutions.indexOf(duplicate)] = renamedDuplicate;
    return renamedDuplicate;
  }

  updateBoard(id: string, board: string): void {
    const solution = this.byId(id);
    this.solutions[this.solutions.indexOf(solution)] = { ...solution, board, scores: null };
  }

  recordTestResult(id: string, board: string, scores: PuzzleScores | null): void {
    const solution = this.byId(id);
    const storedScores = scores === null ? null : parsePuzzleScores(scores, "Puzzle solution");
    this.solutions[this.solutions.indexOf(solution)] = {
      ...solution,
      board,
      scores: storedScores,
    };
  }

  delete(id: string): void {
    const solution = this.byId(id);
    this.solutions.splice(this.solutions.indexOf(solution), 1);
  }

  serialize(): string {
    const stored: StoredPuzzleSolutions = {
      version: PUZZLE_SOLUTIONS_VERSION,
      scoringVersion: PUZZLE_SCORING_VERSION,
      nextSolutionId: this.nextSolutionId,
      solutions: this.solutions,
    };
    return JSON.stringify(stored);
  }
}

export function loadPuzzleSolutions(storage: PuzzleSolutionsStorage): PuzzleSolutions {
  const serialized = storage.getItem(PUZZLE_SOLUTIONS_STORAGE_KEY);
  return serialized === null ? PuzzleSolutions.empty() : PuzzleSolutions.deserialize(serialized);
}

export function savePuzzleSolutions(
  storage: PuzzleSolutionsStorage,
  solutions: PuzzleSolutions,
): void {
  storage.setItem(PUZZLE_SOLUTIONS_STORAGE_KEY, solutions.serialize());
}
