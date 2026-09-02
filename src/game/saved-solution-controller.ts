import type { PuzzleDefinition, PuzzleId } from "./puzzles";
import {
  loadPuzzleSolutions,
  type SavedPuzzleSolution,
  PuzzleSolutions,
  savePuzzleSolutions,
} from "./puzzle-solutions";
import type { PuzzleScores } from "./puzzle-scores";
import { serializeBoard } from "../simulation/board-export";
import type { World } from "../simulation/world";

type PuzzleSolutionStorage = Pick<Storage, "getItem" | "setItem">;

export class SavedSolutionController {
  private readonly dirtySolutionIds = new Set<string>();
  private readonly puzzleSolutions: PuzzleSolutions;

  constructor(private readonly storage: PuzzleSolutionStorage) {
    try {
      this.puzzleSolutions = loadPuzzleSolutions(storage);
    } catch (error) {
      console.error("Could not load puzzle solutions:", error);
      this.puzzleSolutions = PuzzleSolutions.empty();
    }
  }

  forPuzzle(puzzleId: PuzzleId): readonly SavedPuzzleSolution[] {
    return this.puzzleSolutions.forPuzzle(puzzleId);
  }

  findById(solutionId: string): SavedPuzzleSolution | undefined {
    return this.puzzleSolutions.findById(solutionId);
  }

  byId(solutionId: string): SavedPuzzleSolution {
    return this.puzzleSolutions.byId(solutionId);
  }


  create(puzzle: PuzzleDefinition): SavedPuzzleSolution {
    const board = serializeBoard(puzzle.createInitialWorld(), 0);
    const solution = this.puzzleSolutions.create(puzzle.id, board);
    this.persist();
    return solution;
  }

  duplicate(solutionId: string): SavedPuzzleSolution {
    const duplicate = this.puzzleSolutions.duplicate(solutionId);
    this.persist();
    return duplicate;
  }

  delete(solutionId: string): SavedPuzzleSolution {
    const solution = this.byId(solutionId);
    this.puzzleSolutions.delete(solutionId);
    this.dirtySolutionIds.delete(solutionId);
    this.persist();
    return solution;
  }

  markDirty(solutionId: string): void {
    this.byId(solutionId);
    this.dirtySolutionIds.add(solutionId);
  }

  persistBoardIfDirty(solutionId: string, baseline: World): void {
    if (!this.dirtySolutionIds.has(solutionId)) {
      return;
    }
    this.puzzleSolutions.updateBoard(solutionId, serializeBoard(baseline, 0));
    this.persist();
    this.dirtySolutionIds.delete(solutionId);
  }

  recordTestResult(
    solutionId: string,
    baseline: World,
    scores: PuzzleScores | null,
  ): void {
    this.puzzleSolutions.recordTestResult(
      solutionId,
      serializeBoard(baseline, 0),
      scores,
    );
    this.persist();
    this.dirtySolutionIds.delete(solutionId);
  }

  private persist(): void {
    try {
      savePuzzleSolutions(this.storage, this.puzzleSolutions);
    } catch (error) {
      console.error("Could not save puzzle solutions:", error);
    }
  }
}
