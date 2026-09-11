import type { PuzzleTestReport } from "../game/puzzle-test-runner";
import type { PuzzleDefinition } from "../game/puzzles";
import { expectDefined } from "../util/assert";
import { formatPuzzleScore } from "./puzzle-score-format";

export interface PuzzleTestReportCallbacks {
  readonly onContinueEditing: () => void;
  readonly onBackToPuzzle: () => void;
  readonly onNextPuzzle: (puzzleId: string) => void;
}

export class PuzzleTestReportView {
  private readonly title: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly results: HTMLElement;
  private readonly scores: HTMLElement;
  private readonly price: HTMLElement;
  private readonly cycles: HTMLElement;
  private readonly footprint: HTMLElement;
  private readonly combined: HTMLElement;
  private readonly nextButton: HTMLButtonElement;
  private nextPuzzleId: string | null = null;

  constructor(
    private readonly dialog: HTMLDialogElement,
    callbacks: PuzzleTestReportCallbacks,
  ) {
    this.title = requiredDescendant(dialog, "[data-test-report-title]");
    this.summary = requiredDescendant(dialog, "[data-test-report-summary]");
    this.results = requiredDescendant(dialog, "[data-test-report-results]");
    this.scores = requiredDescendant(dialog, "[data-test-report-scores]");
    this.price = requiredDescendant(dialog, "[data-test-report-price]");
    this.cycles = requiredDescendant(dialog, "[data-test-report-cycles]");
    this.footprint = requiredDescendant(dialog, "[data-test-report-footprint]");
    this.combined = requiredDescendant(dialog, "[data-test-report-combined]");
    this.nextButton = requiredDescendant<HTMLButtonElement>(dialog, "[data-test-report-next]");
    this.nextButton.addEventListener("click", () => {
      if (this.nextPuzzleId === null) {
        return;
      }
      const puzzleId = this.nextPuzzleId;
      this.close();
      callbacks.onNextPuzzle(puzzleId);
    });
    requiredDescendant<HTMLButtonElement>(dialog, "[data-test-report-continue]")
      .addEventListener("click", () => {
        this.close();
        callbacks.onContinueEditing();
      });
    requiredDescendant<HTMLButtonElement>(dialog, "[data-test-report-back]")
      .addEventListener("click", () => {
        this.close();
        callbacks.onBackToPuzzle();
      });
  }

  show(
    report: PuzzleTestReport,
    nextPuzzle: PuzzleDefinition | null,
    previousBest: PuzzleTestReport["scores"],
  ): void {
    const availableNext = report.succeeded ? nextPuzzle : null;
    this.nextPuzzleId = availableNext?.id ?? null;
    this.nextButton.hidden = availableNext === null;
    this.nextButton.textContent = availableNext === null ? "" : `NEXT: ${availableNext.name}`;
    const passed = report.results.reduce(
      (count, result) => count + (result.outcome === "won" ? 1 : 0),
      0,
    );
    this.dialog.classList.toggle("succeeded", report.succeeded);
    this.title.textContent = report.succeeded ? "ALL TESTS PASSED" : "TESTS FAILED";
    this.summary.textContent = report.succeeded
      ? `All ${report.results.length} test cases reached victory.`
      : `${passed} of ${report.results.length} test cases reached victory.`;

    this.scores.hidden = !report.succeeded;
    if (report.succeeded) {
      const scores = expectDefined(
        report.scores ?? undefined,
        "Successful puzzle test report is missing scores",
      );
      this.showScore(this.price, scores.price, previousBest?.price);
      this.showScore(this.cycles, scores.cycles, previousBest?.cycles);
      this.showScore(this.footprint, scores.footprint, previousBest?.footprint);
      this.showScore(this.combined, scores.combined, previousBest?.combined);
    }

    const items = report.results.map((result) => {
      const item = document.createElement("li");
      item.className = `test-report-result ${result.outcome}`;

      const name = document.createElement("span");
      name.textContent = result.name;
      const outcome = document.createElement("strong");
      outcome.textContent = result.outcome === "won"
        ? "PASSED"
        : result.outcome === "lost" ? "FAILED" : "CYCLE LIMIT";
      const cycles = document.createElement("small");
      cycles.textContent = result.outcome === "cycle-limit"
        ? `${result.cycles} / ${result.cycleLimit} cycles`
        : `${result.cycles} ${result.cycles === 1 ? "cycle" : "cycles"}`;
      item.append(name, outcome, cycles);
      return item;
    });
    this.results.replaceChildren(...items);
    this.dialog.showModal();
  }

  private showScore(element: HTMLElement, score: number, previousBest: number | undefined): void {
    element.textContent = formatPuzzleScore(score);
    if (previousBest === undefined) {
      return;
    }
    const delta = score - previousBest;
    const comparison = document.createElement("small");
    comparison.className = `test-report-delta ${delta < 0 ? "improved" : delta > 0 ? "worse" : "equal"}`;
    comparison.textContent = `${delta > 0 ? "+" : ""}${formatPuzzleScore(delta)} vs best`;
    comparison.title = `Previous best: ${formatPuzzleScore(previousBest)}. Lower is better.`;
    element.append(comparison);
  }

  close(): void {
    this.nextPuzzleId = null;
    if (this.dialog.open) {
      this.dialog.close();
    }
  }
}

function requiredDescendant<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required test report element ${selector}`);
  }
  return element;
}
