import type { PuzzleDefinition, PuzzleTestCaseDefinition } from "./puzzles";
import {
  createPuzzleTestCaseWorld,
  PuzzleTestRun,
  type PuzzleTestReport,
} from "./puzzle-test-runner";
import type { Simulation } from "../simulation/simulation";
import type { World } from "../simulation/world";
import { expectDefined } from "../util/assert";
import { PuzzleTestReportView } from "../ui/puzzle-test-report";

const INITIAL_TEST_TICKS_PER_SECOND = 5;
const MAX_TEST_TICKS_PER_SECOND = 60;
const TEST_SPEED_DOUBLING_MS = 3_000;
const TEST_CASE_TRANSITION_MS = 600;
const MAX_AUTOMATIC_ANIMATION_MS = 250;

export type PuzzleTestLifecycle =
  | { readonly kind: "idle" }
  | PuzzleTestViewingState
  | PuzzleTestRunningState
  | PuzzleTestBetweenCasesState
  | PuzzleTestCompletedState;

interface PuzzleTestContext {
  readonly puzzle: PuzzleDefinition;
  readonly viewedCaseId: string;
}


type PuzzleTestRunMode = "automatic" | "manual";
interface PuzzleTestViewingState extends PuzzleTestContext {
  readonly kind: "viewing-case";
}

interface PuzzleTestRunningState extends PuzzleTestContext {
  readonly kind: "running";
  readonly mode: PuzzleTestRunMode;
  readonly run: PuzzleTestRun;
  readonly caseStartedAt: number;
  readonly accumulatedMs: number;
}

interface PuzzleTestBetweenCasesState extends PuzzleTestContext {
  readonly kind: "between-cases";
  readonly run: PuzzleTestRun;
  readonly mode: PuzzleTestRunMode;
  readonly nextCaseAt: number;
}

interface PuzzleTestCompletedState extends PuzzleTestContext {
  readonly kind: "failed" | "succeeded";
  readonly report: PuzzleTestReport;
}

export interface PuzzleTestControllerElements {
  readonly caseDropup: HTMLElement;
  readonly caseButton: HTMLButtonElement;
  readonly caseOptions: HTMLElement;
  readonly statusToast: HTMLElement;
  readonly reportDialog: HTMLDialogElement;
}

export interface PuzzleTestControllerDependencies {
  readonly getBaseline: () => World;
  readonly prepareForRuntimeChange: () => void;
  readonly resetSession: () => void;
  readonly beginSimulation: () => void;
  readonly mountRuntime: (world: World, simulation?: Simulation) => void;
  readonly beforeStep: () => World;
  /** Observes the live case world after every committed test step, including fast-forwarding. */
  readonly afterStep: (world: World, tick: number) => void;
  readonly setStepAnimation: (startedAt: number, duration: number) => void;
  readonly finishAnimation: () => void;
  readonly animationsEnabled: (ticksPerSecond: number) => boolean;
  readonly recordResult: (scores: PuzzleTestReport["scores"]) => void;
  readonly refreshTransport: () => void;
  readonly refreshHover: () => void;
  readonly leaveWorkshop: () => void;
}

interface PuzzleTestViewCallbacks {
  readonly onContinueEditing: () => void;
  readonly onBackToPuzzle: () => void;
  readonly onSelectCase: (testCaseId: string) => void;
}

export interface PuzzleTestControllerView {
  configureCases(puzzle: PuzzleDefinition | null, selectedCaseId: string | null): void;
  selectCase(testCaseId: string): void;
  setCaseOptionsOpen(open: boolean): void;
  toggleCaseOptions(): void;
  hideStatus(): void;
  showFailure(message: string): void;
  showReport(report: PuzzleTestReport): void;
  closeReport(): void;
}

type PuzzleTestViewFactory = (
  callbacks: PuzzleTestViewCallbacks,
) => PuzzleTestControllerView;

/** Owns puzzle verification presentation and its complete tagged lifecycle. */
export class PuzzleTestController {
  private lifecycleValue: PuzzleTestLifecycle = { kind: "idle" };
  private readonly view: PuzzleTestControllerView;

  constructor(
    elements: PuzzleTestControllerElements,
    private readonly dependencies: PuzzleTestControllerDependencies,
    createView: PuzzleTestViewFactory = (callbacks) => new DomPuzzleTestControllerView(
      elements,
      callbacks,
    ),
  ) {
    this.view = createView({
      onContinueEditing: () => this.reset(),
      onBackToPuzzle: dependencies.leaveWorkshop,
      onSelectCase: (testCaseId) => this.showCase(testCaseId),
    });
  }

  get lifecycle(): PuzzleTestLifecycle {
    return this.lifecycleValue;
  }

  get testing(): boolean {
    return this.lifecycleValue.kind === "running" || this.lifecycleValue.kind === "between-cases";
  }

  get manualStepping(): boolean {
    const state = this.lifecycleValue;
    return (state.kind === "running" || state.kind === "between-cases") &&
      state.mode === "manual";
  }

  get viewedCaseId(): string | null {
    return this.lifecycleValue.kind === "idle" ? null : this.lifecycleValue.viewedCaseId;
  }

  configure(puzzle: PuzzleDefinition | null): void {
    if (puzzle === null) {
      this.lifecycleValue = { kind: "idle" };
      this.view.configureCases(null, null);
      return;
    }
    const firstCase = expectDefined(puzzle.testCases[0], `Puzzle "${puzzle.id}" first test case`);
    this.lifecycleValue = {
      kind: "viewing-case",
      puzzle,
      viewedCaseId: firstCase.id,
    };
    this.view.configureCases(puzzle, firstCase.id);
  }

  showCase(testCaseId: string): void {
    const state = this.lifecycleValue;
    if (state.kind === "idle" || state.kind === "running" || state.kind === "between-cases") {
      return;
    }
    const testCase = this.testCase(state.puzzle, testCaseId);
    this.dependencies.prepareForRuntimeChange();
    this.dependencies.resetSession();
    const world = createPuzzleTestCaseWorld(
      testCase,
      state.puzzle.editableRegion,
      this.dependencies.getBaseline(),
    );
    this.dependencies.mountRuntime(world);
    this.lifecycleValue = {
      kind: "viewing-case",
      puzzle: state.puzzle,
      viewedCaseId: testCase.id,
    };
    this.view.selectCase(testCase.id);
    this.view.hideStatus();
    this.view.closeReport();
    this.refreshPresentation();
  }

  start(startedAt = performance.now()): void {
    const state = this.lifecycleValue;
    if (state.kind === "idle" || state.kind === "running" || state.kind === "between-cases") {
      return;
    }
    this.beginRun(state, "automatic", startedAt);
  }

  step(duration: number, startedAt = performance.now()): void {
    const initialState = this.lifecycleValue;
    if (
      initialState.kind === "idle" ||
      initialState.kind === "failed" ||
      initialState.kind === "succeeded"
    ) {
      return;
    }

    let state: PuzzleTestRunningState;
    if (initialState.kind === "viewing-case") {
      state = this.beginRun(initialState, "manual", startedAt);
    } else if (initialState.kind === "between-cases") {
      if (initialState.mode !== "manual") {
        return;
      }
      initialState.run.continueToNextCase();
      this.dependencies.mountRuntime(initialState.run.world, initialState.run.simulation);
      state = {
        kind: "running",
        puzzle: initialState.puzzle,
        viewedCaseId: initialState.run.currentCase.id,
        mode: "manual",
        run: initialState.run,
        caseStartedAt: startedAt,
        accumulatedMs: 0,
      };
      this.lifecycleValue = state;
      this.view.selectCase(state.viewedCaseId);
    } else {
      if (initialState.kind !== "running" || initialState.mode !== "manual") {
        return;
      }
      state = initialState;
    }

    const interpolationSource = this.dependencies.beforeStep();
    const status = state.run.step(duration > 0 ? interpolationSource : undefined);
    this.dependencies.afterStep(state.run.world, state.run.simulation.tick);
    this.dependencies.setStepAnimation(startedAt, duration);
    if (status === "between-cases") {
      this.lifecycleValue = {
        kind: "between-cases",
        puzzle: state.puzzle,
        viewedCaseId: state.run.currentCase.id,
        mode: "manual",
        run: state.run,
        nextCaseAt: startedAt,
      };
      this.refreshPresentation();
    } else if (status === "failed" || status === "succeeded") {
      this.finish(expectDefined(state.run.report ?? undefined, "Completed puzzle test report"));
    }
  }

  advanceFrame(currentTime: number, elapsed: number): void {
    const state = this.lifecycleValue;
    if (state.kind === "between-cases") {
      if (state.mode === "manual") {
        return;
      }
      if (currentTime < state.nextCaseAt) {
        return;
      }
      state.run.continueToNextCase();
      this.dependencies.mountRuntime(state.run.world, state.run.simulation);
      this.lifecycleValue = {
        kind: "running",
        puzzle: state.puzzle,
        viewedCaseId: state.run.currentCase.id,
        mode: state.mode,
        run: state.run,
        caseStartedAt: currentTime,
        accumulatedMs: 0,
      };
      this.view.selectCase(state.run.currentCase.id);
      this.refreshPresentation();
      return;
    }
    if (state.kind !== "running" || state.mode === "manual") {
      return;
    }

    let accumulatedMs = state.accumulatedMs + elapsed;
    const ticksPerSecond = this.testTicksPerSecond(currentTime, state.caseStartedAt);
    const tickDuration = 1000 / ticksPerSecond;
    while (accumulatedMs >= tickDuration && state.run.status === "running") {
      accumulatedMs -= tickDuration;
      const interpolationSource = this.dependencies.beforeStep();
      const animationDuration = this.dependencies.animationsEnabled(ticksPerSecond)
        ? Math.min(tickDuration, MAX_AUTOMATIC_ANIMATION_MS)
        : 0;
      const status = state.run.step(animationDuration > 0 ? interpolationSource : undefined);
      this.dependencies.afterStep(state.run.world, state.run.simulation.tick);
      this.dependencies.setStepAnimation(
        currentTime - accumulatedMs,
        animationDuration,
      );
      if (status === "between-cases") {
        this.lifecycleValue = {
          kind: "between-cases",
          puzzle: state.puzzle,
          viewedCaseId: state.run.currentCase.id,
          mode: state.mode,
          run: state.run,
          nextCaseAt: currentTime + TEST_CASE_TRANSITION_MS,
        };
        this.refreshPresentation();
        return;
      }
      if (status === "failed" || status === "succeeded") {
        this.finish(expectDefined(state.run.report ?? undefined, "Completed puzzle test report"));
        return;
      }
    }
    this.lifecycleValue = { ...state, accumulatedMs };
  }

  fastForward(): void {
    const state = this.lifecycleValue;
    if (state.kind !== "running" && state.kind !== "between-cases") {
      return;
    }
    this.dependencies.finishAnimation();
    const report = state.run.runRemaining(this.dependencies.afterStep);
    this.dependencies.mountRuntime(state.run.world, state.run.simulation);
    this.view.selectCase(state.run.currentCase.id);
    this.finish(report);
  }

  reset(): void {
    const state = this.lifecycleValue;
    if (state.kind === "idle") {
      return;
    }
    const testCase = this.testCase(state.puzzle, state.viewedCaseId);
    this.dependencies.prepareForRuntimeChange();
    this.dependencies.resetSession();
    const world = createPuzzleTestCaseWorld(
      testCase,
      state.puzzle.editableRegion,
      this.dependencies.getBaseline(),
    );
    this.dependencies.mountRuntime(world);
    this.dependencies.finishAnimation();
    this.lifecycleValue = {
      kind: "viewing-case",
      puzzle: state.puzzle,
      viewedCaseId: testCase.id,
    };
    this.view.selectCase(testCase.id);
    this.view.hideStatus();
    this.view.closeReport();
    this.refreshPresentation();
  }

  stop(): void {
    this.lifecycleValue = { kind: "idle" };
    this.view.configureCases(null, null);
    this.view.hideStatus();
    this.view.closeReport();
    this.refreshPresentation();
  }

  toggleCaseOptions(): void {
    this.view.toggleCaseOptions();
  }

  closeCaseOptions(): void {
    this.view.setCaseOptionsOpen(false);
  }

  private beginRun(
    state: PuzzleTestViewingState | PuzzleTestCompletedState,
    mode: PuzzleTestRunMode,
    startedAt: number,
  ): PuzzleTestRunningState {
    this.dependencies.prepareForRuntimeChange();
    this.dependencies.resetSession();
    this.view.hideStatus();
    this.view.closeReport();
    const run = new PuzzleTestRun(state.puzzle, this.dependencies.getBaseline());
    this.dependencies.beginSimulation();
    this.dependencies.mountRuntime(run.world, run.simulation);
    const runningState: PuzzleTestRunningState = {
      kind: "running",
      puzzle: state.puzzle,
      viewedCaseId: run.currentCase.id,
      mode,
      run,
      caseStartedAt: startedAt,
      accumulatedMs: 0,
    };
    this.lifecycleValue = runningState;
    this.view.selectCase(run.currentCase.id);
    this.refreshPresentation();
    return runningState;
  }

  private finish(report: PuzzleTestReport): void {
    const state = this.lifecycleValue;
    if (state.kind !== "running" && state.kind !== "between-cases") {
      throw new Error(`Cannot finish puzzle tests while ${state.kind}`);
    }
    this.dependencies.finishAnimation();
    this.dependencies.recordResult(report.scores);
    this.lifecycleValue = {
      kind: report.succeeded ? "succeeded" : "failed",
      puzzle: state.puzzle,
      viewedCaseId: state.run.currentCase.id,
      report,
    };
    if (report.succeeded) {
      this.view.hideStatus();
      this.view.showReport(report);
    } else {
      const failed = expectDefined(
        report.results[report.results.length - 1],
        "Failed puzzle test result",
      );
      this.view.showFailure(failed.outcome === "cycle-limit"
        ? `Failed: test case "${failed.name}" reached cycle limit ${failed.cycleLimit}`
        : `Failed: test case "${failed.name}" cycle ${failed.cycles}`);
    }
    this.refreshPresentation();
  }

  private testTicksPerSecond(currentTime: number, caseStartedAt: number): number {
    const elapsed = Math.max(0, currentTime - caseStartedAt);
    return Math.min(
      MAX_TEST_TICKS_PER_SECOND,
      INITIAL_TEST_TICKS_PER_SECOND * 2 ** (elapsed / TEST_SPEED_DOUBLING_MS),
    );
  }

  private testCase(puzzle: PuzzleDefinition, testCaseId: string): PuzzleTestCaseDefinition {
    return expectDefined(
      puzzle.testCases.find((candidate) => candidate.id === testCaseId),
      `Puzzle "${puzzle.id}" test case "${testCaseId}"`,
    );
  }

  private refreshPresentation(): void {
    this.dependencies.refreshTransport();
    this.dependencies.refreshHover();
  }
}

class DomPuzzleTestControllerView implements PuzzleTestControllerView {
  private readonly report: PuzzleTestReportView;

  constructor(
    private readonly elements: PuzzleTestControllerElements,
    private readonly callbacks: PuzzleTestViewCallbacks,
  ) {
    this.report = new PuzzleTestReportView(elements.reportDialog, {
      onContinueEditing: callbacks.onContinueEditing,
      onBackToPuzzle: callbacks.onBackToPuzzle,
    });
  }

  configureCases(puzzle: PuzzleDefinition | null, selectedCaseId: string | null): void {
    this.elements.caseOptions.replaceChildren();
    this.setCaseOptionsOpen(false);
    if (puzzle === null) {
      this.elements.caseDropup.hidden = true;
      return;
    }
    for (const testCase of puzzle.testCases) {
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = testCase.name;
      option.dataset.testCaseId = testCase.id;
      option.addEventListener("click", () => {
        this.setCaseOptionsOpen(false);
        this.callbacks.onSelectCase(testCase.id);
      });
      this.elements.caseOptions.append(option);
    }
    this.elements.caseDropup.hidden = false;
    if (selectedCaseId !== null) {
      this.selectCase(selectedCaseId);
    }
  }

  selectCase(testCaseId: string): void {
    let selectedName: string | null = null;
    for (const option of this.elements.caseOptions.querySelectorAll<HTMLButtonElement>("button")) {
      const selected = option.dataset.testCaseId === testCaseId;
      option.setAttribute("aria-pressed", String(selected));
      if (selected) {
        selectedName = option.textContent;
      }
    }
    if (selectedName === null) {
      throw new Error(`Missing test case option "${testCaseId}"`);
    }
    this.elements.caseButton.textContent = `CASE: ${selectedName}`;
  }

  setCaseOptionsOpen(open: boolean): void {
    this.elements.caseOptions.hidden = !open;
    this.elements.caseButton.setAttribute("aria-expanded", String(open));
  }

  toggleCaseOptions(): void {
    this.setCaseOptionsOpen(this.elements.caseOptions.hidden !== false);
  }

  hideStatus(): void {
    this.elements.statusToast.hidden = true;
    this.elements.statusToast.textContent = "";
  }

  showFailure(message: string): void {
    this.elements.statusToast.textContent = message;
    this.elements.statusToast.hidden = false;
  }

  showReport(report: PuzzleTestReport): void {
    this.report.show(report);
  }

  closeReport(): void {
    this.report.close();
  }
}
