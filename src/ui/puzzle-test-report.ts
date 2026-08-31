import type { PuzzleTestReport } from "../game/puzzle-test-runner";

export interface PuzzleTestReportCallbacks {
  readonly onContinueEditing: () => void;
  readonly onBackToPuzzle: () => void;
}

export class PuzzleTestReportView {
  private readonly title: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly results: HTMLElement;

  constructor(
    private readonly dialog: HTMLDialogElement,
    callbacks: PuzzleTestReportCallbacks,
  ) {
    this.title = requiredDescendant(dialog, "[data-test-report-title]");
    this.summary = requiredDescendant(dialog, "[data-test-report-summary]");
    this.results = requiredDescendant(dialog, "[data-test-report-results]");
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

  show(report: PuzzleTestReport): void {
    const passed = report.results.reduce(
      (count, result) => count + (result.outcome === "won" ? 1 : 0),
      0,
    );
    this.dialog.classList.toggle("succeeded", report.succeeded);
    this.title.textContent = report.succeeded ? "ALL TESTS PASSED" : "TESTS FAILED";
    this.summary.textContent = report.succeeded
      ? `All ${report.results.length} test cases reached victory.`
      : `${passed} of ${report.results.length} test cases reached victory.`;

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

  close(): void {
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
