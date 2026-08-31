import {
  appScreenPath,
  resolveAppPath,
  resolveAppScreen,
  type AppRouteAccess,
} from "./app-route";
import {
  loadCompletedPuzzleIds,
  recordPuzzleResult,
  saveCompletedPuzzleIds,
} from "./puzzle-progress";
import { PUZZLES, puzzleById, type PuzzleId } from "./puzzles";
import type { AppScreen } from "./screen";
import { SavedSolutionController } from "./saved-solution-controller";
import { WorkshopSessionController } from "./workshop-session";
import { populatePuzzleMap } from "../ui/main-menu";
import { PuzzleInfoView } from "../ui/puzzle-info";
import { PuzzleResult } from "../simulation/puzzle-result";

type PuzzleProgressStorage = Pick<Storage, "getItem" | "setItem">;
type NavigationHistory = Pick<History, "pushState" | "replaceState">;


export interface NavigationElements {
  readonly gameScreen: HTMLElement;
  readonly mainMenuScreen: HTMLElement;
  readonly puzzleInfoScreen: HTMLElement;
  readonly puzzleMap: HTMLElement;
  readonly screenTitle: HTMLElement;
  readonly screenDescription: HTMLElement;
  readonly menuButton: HTMLButtonElement;
}

export interface NavigationCallbacks {
  readonly stopSimulation: () => void;
  readonly onWorkshopSessionChanged: () => void;
  readonly onWorkshopShown: () => void;
}

export class NavigationController {
  private readonly puzzleInfoView: PuzzleInfoView;
  private readonly completedPuzzleIds: Set<PuzzleId>;
  private currentScreen: AppScreen = { kind: "main-menu" };
  private readonly routeAccess: AppRouteAccess;


  constructor(
    private readonly elements: NavigationElements,
    private readonly callbacks: NavigationCallbacks,
    private readonly sessions: WorkshopSessionController,
    private readonly solutions: SavedSolutionController,
    private readonly storage: PuzzleProgressStorage,
    private readonly history: NavigationHistory,
  ) {
    this.puzzleInfoView = new PuzzleInfoView(elements.puzzleInfoScreen);
    try {
      this.completedPuzzleIds = loadCompletedPuzzleIds(storage);
    } catch (error) {
      console.error("Could not load puzzle progress:", error);
      this.completedPuzzleIds = new Set();
    }
    this.routeAccess = {
      completedPuzzleIds: this.completedPuzzleIds,
      solutionExists: (puzzleId, solutionId) =>
        this.solutions.findById(solutionId)?.puzzleId === puzzleId,
    };
  }

  get screen(): AppScreen {
    return this.currentScreen;
  }

  navigate(screen: AppScreen): void {
    const resolvedScreen = resolveAppScreen(screen, this.routeAccess);
    this.showScreen(resolvedScreen);
    this.history.pushState(null, "", appScreenPath(resolvedScreen));
  }

  navigatePath(pathname: string): void {
    const screen = resolveAppPath(pathname, this.routeAccess);
    this.showScreen(screen);
    const canonicalPath = appScreenPath(screen);
    if (pathname !== canonicalPath) {
      this.history.replaceState(null, "", canonicalPath);
    }
  }

  private showScreen(screen: AppScreen): void {
    this.callbacks.stopSimulation();
    this.persistActiveSolutionBoard();
    this.currentScreen = screen;

    const showingMainMenu = screen.kind === "main-menu";
    const showingPuzzleInfo = screen.kind === "puzzle-info";
    this.elements.mainMenuScreen.hidden = !showingMainMenu;
    this.elements.puzzleInfoScreen.hidden = !showingPuzzleInfo;
    this.elements.gameScreen.hidden = showingMainMenu || showingPuzzleInfo;

    if (showingMainMenu) {
      populatePuzzleMap(this.elements.puzzleMap, {
        puzzles: PUZZLES,
        completedPuzzleIds: this.completedPuzzleIds,
        onSelectPuzzle: (puzzleId) => {
          this.navigate({ kind: "puzzle-info", puzzleId });
        },
      });
      return;
    }

    if (showingPuzzleInfo) {
      this.renderPuzzleInfo(screen.puzzleId);
      return;
    }

    let sessionChanged: boolean;
    if (screen.kind === "sandbox") {
      sessionChanged = this.sessions.activateSandbox();
      this.elements.menuButton.textContent = "← MENU";
      this.elements.screenTitle.textContent = "SANDBOX";
      this.elements.screenDescription.textContent = "Free construction workshop";
      this.elements.gameScreen.setAttribute("aria-label", "Sandbox workshop");
    } else {
      const puzzle = puzzleById(screen.puzzleId);
      const solution = this.solutions.byId(screen.solutionId);
      sessionChanged = this.sessions.activateSolution(solution, puzzle);
      this.solutions.select(screen.puzzleId, screen.solutionId);
      this.elements.menuButton.textContent = "← PUZZLE";
      this.elements.screenTitle.textContent = puzzle.name.toUpperCase();
      this.elements.screenDescription.textContent = `${solution.name} · Goal: ${puzzle.goal}`;
      this.elements.gameScreen.setAttribute("aria-label", `${puzzle.name} puzzle workshop`);
    }

    if (sessionChanged) {
      this.callbacks.onWorkshopSessionChanged();
    }
    this.callbacks.onWorkshopShown();
  }

  leaveWorkshop(): void {
    if (this.currentScreen.kind === "puzzle") {
      this.navigate({
        kind: "puzzle-info",
        puzzleId: this.currentScreen.puzzleId,
      });
      return;
    }
    this.navigate({ kind: "main-menu" });
  }

  markActiveSolutionDirty(): void {
    if (this.currentScreen.kind === "puzzle") {
      this.solutions.markDirty(this.currentScreen.solutionId);
    }
  }

  persistActiveSolutionBoard(): void {
    if (this.currentScreen.kind === "puzzle") {
      this.solutions.persistBoardIfDirty(
        this.currentScreen.solutionId,
        this.sessions.active.baseline,
      );
    }
  }

  recordActivePuzzleTestSuccess(): void {
    if (this.currentScreen.kind !== "puzzle") {
      throw new Error("Cannot record puzzle test success outside a puzzle workshop");
    }
    if (
      !recordPuzzleResult(
        this.completedPuzzleIds,
        this.currentScreen.puzzleId,
        PuzzleResult.Won,
      )
    ) {
      return;
    }
    try {
      saveCompletedPuzzleIds(this.storage, this.completedPuzzleIds);
    } catch (error) {
      console.error("Could not save puzzle progress:", error);
    }
  }

  private openSolution(puzzleId: PuzzleId, solutionId: string): void {
    this.solutions.select(puzzleId, solutionId);
    this.navigate({ kind: "puzzle", puzzleId, solutionId });
  }

  private renderPuzzleInfo(puzzleId: PuzzleId): void {
    const puzzle = puzzleById(puzzleId);
    this.puzzleInfoView.render({
      puzzle,
      solutions: this.solutions.forPuzzle(puzzleId),
      selectedSolutionId: this.solutions.selectedForPuzzle(puzzleId),
      onBack: () => this.navigate({ kind: "main-menu" }),
      onCreate: () => {
        const solution = this.solutions.create(puzzle);
        this.openSolution(puzzleId, solution.id);
      },
      onSelect: (solutionId) => {
        this.solutions.select(puzzleId, solutionId);
        this.renderPuzzleInfo(puzzleId);
      },
      onDuplicate: (solutionId) => {
        this.solutions.duplicate(solutionId);
        this.renderPuzzleInfo(puzzleId);
      },
      onEdit: (solutionId) => this.openSolution(puzzleId, solutionId),
      onDelete: (solutionId) => {
        const solution = this.solutions.byId(solutionId);
        if (!window.confirm(`Delete ${solution.name}? This cannot be undone.`)) {
          return;
        }
        this.solutions.delete(solutionId);
        this.sessions.forgetSolution(solutionId);
        this.renderPuzzleInfo(puzzleId);
      },
    });
  }
}
