import {
  appScreenPath,
  resolveAppPath,
  resolveAppScreen,
} from "./app-route";
import type { AppRouteAccess } from "./app-route";
import {
  loadCompletedPuzzleIds,
  recordPuzzleResult,
  saveCompletedPuzzleIds,
} from "./puzzle-progress";
import { PUZZLES, puzzleById } from "./puzzles";
import type { PuzzleId } from "./puzzles";
import type { AppScreen } from "./screen";
import type { SandboxPuzzleProperties } from "./sandbox-puzzle-authoring";
import type { SavedSandboxController } from "./saved-sandbox-controller";
import type { SavedSolutionController } from "./saved-solution-controller";
import type { PuzzleScores } from "./puzzle-scores";
import type { WorkshopSessionController } from "./workshop-session";
import { populatePuzzleMap } from "../ui/main-menu";
import { PuzzleInfoView } from "../ui/puzzle-info";
import { SandboxInfoView } from "../ui/sandbox-info";
import { WorkshopInfoDialog } from "../ui/workshop-info-dialog";
import { PuzzleResult } from "../simulation/puzzle-result";

type PuzzleProgressStorage = Pick<Storage, "getItem" | "setItem">;
type NavigationHistory = Pick<History, "pushState" | "replaceState">;


export interface NavigationElements {
  readonly gameScreen: HTMLElement;
  readonly mainMenuScreen: HTMLElement;
  readonly sandboxInfoScreen: HTMLElement;
  readonly puzzleInfoScreen: HTMLElement;
  readonly puzzleMap: HTMLElement;
  readonly screenTitle: HTMLElement;
  readonly menuButton: HTMLButtonElement;
  readonly workshopInfoButton: HTMLButtonElement;
  readonly workshopInfoDialog: HTMLDialogElement;
}

export interface NavigationCallbacks {
  readonly stopSimulation: () => void;
  readonly onWorkshopSessionChanged: () => void;
  readonly onWorkshopShown: () => void;
  readonly onSandboxPropertiesChanged: (properties: SandboxPuzzleProperties) => void;
}

export class NavigationController {
  private readonly puzzleInfoView: PuzzleInfoView;
  private readonly workshopInfoDialog: WorkshopInfoDialog;
  private readonly sandboxInfoView: SandboxInfoView;
  private readonly completedPuzzleIds: Set<PuzzleId>;
  private currentScreen: AppScreen = { kind: "main-menu" };
  private readonly routeAccess: AppRouteAccess;


  constructor(
    private readonly elements: NavigationElements,
    private readonly callbacks: NavigationCallbacks,
    private readonly sessions: WorkshopSessionController,
    private readonly solutions: SavedSolutionController,
    private readonly sandboxes: SavedSandboxController,
    private readonly storage: PuzzleProgressStorage,
    private readonly history: NavigationHistory,
  ) {
    this.puzzleInfoView = new PuzzleInfoView(elements.puzzleInfoScreen);
    this.sandboxInfoView = new SandboxInfoView(elements.sandboxInfoScreen);
    this.workshopInfoDialog = new WorkshopInfoDialog(elements.workshopInfoDialog);
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
      sandboxExists: (sandboxId) => this.sandboxes.findById(sandboxId) !== undefined,
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
    this.workshopInfoDialog.close();
    this.callbacks.stopSimulation();
    this.persistActiveWorkshop();
    this.currentScreen = screen;

    const showingMainMenu = screen.kind === "main-menu";
    const showingSandboxInfo = screen.kind === "sandbox-info";
    const showingPuzzleInfo = screen.kind === "puzzle-info";
    this.elements.mainMenuScreen.hidden = !showingMainMenu;
    this.elements.sandboxInfoScreen.hidden = !showingSandboxInfo;
    this.elements.puzzleInfoScreen.hidden = !showingPuzzleInfo;
    this.elements.gameScreen.hidden =
      showingMainMenu || showingSandboxInfo || showingPuzzleInfo;

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

    if (showingSandboxInfo) {
      this.renderSandboxInfo();
      return;
    }

    if (showingPuzzleInfo) {
      this.renderPuzzleInfo(screen.puzzleId);
      return;
    }

    let sessionChanged: boolean;
    if (screen.kind === "sandbox") {
      const sandbox = this.sandboxes.byId(screen.sandboxId);
      sessionChanged = this.sessions.activateSandbox(
        sandbox.id,
        this.sandboxes.import(sandbox.id),
      );
      this.elements.menuButton.textContent = "← SANDBOX";
      this.elements.screenTitle.textContent = sandbox.name.toUpperCase();
      this.elements.workshopInfoButton.setAttribute("aria-label", "Puzzle properties");
      this.elements.workshopInfoButton.title = "Puzzle properties";
      this.elements.workshopInfoButton.onclick = () => {
        const session = this.sessions.active;
        const authoring = session.puzzleAuthoring;
        if (authoring === null) {
          throw new Error("Sandbox puzzle authoring state is missing");
        }
        this.workshopInfoDialog.showProperties(
          authoring.properties(session.world.width, session.world.height),
          this.callbacks.onSandboxPropertiesChanged,
        );
      };
      this.elements.gameScreen.setAttribute("aria-label", "Sandbox workshop");
    } else {
      const puzzle = puzzleById(screen.puzzleId);
      const solution = this.solutions.byId(screen.solutionId);
      sessionChanged = this.sessions.activateSolution(solution, puzzle);
      this.elements.menuButton.textContent = "← PUZZLE";
      this.elements.screenTitle.textContent = puzzle.name.toUpperCase();
      this.elements.workshopInfoButton.setAttribute("aria-label", "Workshop information");
      this.elements.workshopInfoButton.title = "Workshop information";
      this.elements.workshopInfoButton.onclick = () => {
        this.workshopInfoDialog.show({
          name: puzzle.name,
          description: puzzle.description,
          goal: puzzle.goal,
        });
      };
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
    if (this.currentScreen.kind === "sandbox") {
      this.navigate({ kind: "sandbox-info" });
      return;
    }
    this.navigate({ kind: "main-menu" });
  }

  markActiveWorkshopDirty(): void {
    if (this.currentScreen.kind === "puzzle") {
      this.solutions.markDirty(this.currentScreen.solutionId);
    } else if (this.currentScreen.kind === "sandbox") {
      this.sandboxes.markDirty(this.currentScreen.sandboxId);
    }
  }

  persistActiveWorkshop(): void {
    if (this.currentScreen.kind === "puzzle") {
      this.solutions.persistBoardIfDirty(
        this.currentScreen.solutionId,
        this.sessions.active.baseline,
      );
    } else if (this.currentScreen.kind === "sandbox") {
      this.sandboxes.persistSnapshotIfDirty(
        this.currentScreen.sandboxId,
        this.sessions.snapshotActiveSandbox(),
      );
    }
  }

  recordActivePuzzleTestResult(scores: PuzzleScores | null): void {
    if (this.currentScreen.kind !== "puzzle") {
      throw new Error("Cannot record a puzzle test result outside a puzzle workshop");
    }
    this.solutions.recordTestResult(
      this.currentScreen.solutionId,
      this.sessions.active.baseline,
      scores,
    );
    if (
      scores === null ||
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

  private openSandbox(sandboxId: string): void {
    this.navigate({ kind: "sandbox", sandboxId });
  }

  private renderSandboxInfo(): void {
    this.sandboxInfoView.render({
      sandboxes: this.sandboxes.entries,
      onBack: () => this.navigate({ kind: "main-menu" }),
      onCreate: () => {
        const sandbox = this.sandboxes.create();
        this.openSandbox(sandbox.id);
      },
      onDuplicate: (sandboxId) => {
        this.sandboxes.duplicate(sandboxId);
        this.renderSandboxInfo();
      },
      onEdit: (sandboxId) => this.openSandbox(sandboxId),
      onDelete: (sandboxId) => {
        const sandbox = this.sandboxes.byId(sandboxId);
        if (!window.confirm(`Delete ${sandbox.name}? This cannot be undone.`)) {
          return;
        }
        this.sandboxes.delete(sandboxId);
        this.sessions.forgetSandbox(sandboxId);
        this.renderSandboxInfo();
      },
    });
  }

  private openSolution(puzzleId: PuzzleId, solutionId: string): void {
    this.navigate({ kind: "puzzle", puzzleId, solutionId });
  }

  private renderPuzzleInfo(puzzleId: PuzzleId): void {
    const puzzle = puzzleById(puzzleId);
    this.puzzleInfoView.render({
      puzzle,
      solutions: this.solutions.forPuzzle(puzzleId),
      onBack: () => this.navigate({ kind: "main-menu" }),
      onCreate: () => {
        const solution = this.solutions.create(puzzle);
        this.openSolution(puzzleId, solution.id);
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
