import { SCORE_METRICS, type PuzzleHistograms, type ScoreMetric } from "../game/community-api";
import { bestPuzzleScores, scoreStanding } from "../game/score-histogram";
import { PUZZLE_DIFFICULTIES } from "../game/puzzle-difficulty";
import type { PuzzleScores } from "../game/puzzle-scores";
import type { SavedPuzzleSolution } from "../game/puzzle-solutions";
import type { PuzzleDefinition } from "../game/puzzles";
import { formatPuzzleScore } from "./puzzle-score-format";

export interface PuzzleInfoOptions {
  readonly puzzle: PuzzleDefinition;
  readonly solutions: readonly SavedPuzzleSolution[];
  readonly onBack: () => void;
  readonly onCreate: () => void;
  readonly onDuplicate: (solutionId: string) => void;
  readonly onEdit: (solutionId: string) => void;
  readonly onDelete: (solutionId: string) => void;
}

function requiredDescendant<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required puzzle info element ${selector}`);
  }
  return element;
}

export class PuzzleInfoView {
  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private readonly difficulty: HTMLElement;
  private readonly testCaseWarning: HTMLElement;
  private readonly testCaseCount: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly solutionList: HTMLElement;
  private readonly emptySolutions: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly newButton: HTMLButtonElement;
  private readonly rankedScores: { element: HTMLElement; metric: ScoreMetric; value: number }[] = [];

  constructor(root: HTMLElement) {
    this.title = requiredDescendant(root, "#puzzle-info-title");
    this.description = requiredDescendant(root, "#puzzle-info-description");
    this.difficulty = requiredDescendant(root, "#puzzle-briefing-difficulty");
    this.testCaseWarning = requiredDescendant(root, "#puzzle-test-case-warning");
    this.testCaseCount = requiredDescendant(root, "#puzzle-test-case-count");
    this.goal = requiredDescendant(root, "#puzzle-info-goal");
    this.solutionList = requiredDescendant(root, "#solution-list");
    this.emptySolutions = requiredDescendant(root, "#empty-solutions");
    this.backButton = requiredDescendant(root, "#puzzle-info-back-button");
    this.newButton = requiredDescendant(root, "#new-solution-button");
  }

  render(options: PuzzleInfoOptions): void {
    this.title.textContent = options.puzzle.name;
    this.description.textContent = options.puzzle.description;
    const rating = PUZZLE_DIFFICULTIES[options.puzzle.difficulty];
    this.difficulty.textContent = `${rating.mark} ${rating.label}`;
    this.difficulty.ariaLabel = options.puzzle.difficulty === "tutorial"
      ? `${rating.label} puzzle`
      : `${rating.label} — ${options.puzzle.difficulty} of 5 stars`;
    this.difficulty.title = this.difficulty.ariaLabel;
    this.testCaseWarning.hidden = options.puzzle.testCases.length <= 1;
    this.testCaseCount.textContent = `${options.puzzle.testCases.length} test cases`;
    this.goal.textContent = options.puzzle.goal;

    const bestScores = bestPuzzleScores(options.solutions.map((solution) => solution.scores));

    this.rankedScores.length = 0;
    const solutionRows = options.solutions.map((solution) =>
      this.createSolutionRow(solution, bestScores, options),
    ).reverse();
    this.solutionList.replaceChildren(...solutionRows);
    this.emptySolutions.hidden = solutionRows.length !== 0;

    this.backButton.onclick = options.onBack;
    this.newButton.onclick = options.onCreate;
  }

  updateScoreRanks(data: PuzzleHistograms | null): void {
    for (const { element, metric, value } of this.rankedScores) {
      const standing = data === null ? null : scoreStanding(data.metrics[metric], value);
      if (standing === null) {
        delete element.dataset.scoreMineral;
        element.removeAttribute("title");
      } else {
        element.dataset.scoreMineral = standing.mineral;
        element.title = `${standing.mineral} · Percentile ${formatPuzzleScore(standing.percentile)}${standing.players < 10 ? " · provisional" : ""}`;
      }
    }
  }

  private createSolutionRow(
    solution: SavedPuzzleSolution,
    bestScores: PuzzleScores | null,
    options: PuzzleInfoOptions,
  ): HTMLElement {
    const row = document.createElement("article");
    row.className = "solution-row";
    row.setAttribute("role", "listitem");
    if (solution.scores !== null && bestScores !== null &&
      SCORE_METRICS.some((metric) => solution.scores?.[metric] === bestScores[metric])) {
      row.classList.add("best-score");
      row.dataset.bestScore = "true";
    }

    const identity = document.createElement("div");
    identity.className = "solution-identity";
    const name = document.createElement("strong");
    name.textContent = solution.name;
    identity.append(name);
    if (solution.scores === null) {
      const status = document.createElement("small");
      status.className = "unconfirmed";
      status.textContent = "Not yet confirmed";
      identity.append(status);
    } else {
      const status = document.createElement("span");
      status.className = "solution-confirmed";
      status.setAttribute("role", "img");
      status.ariaLabel = "Confirmed successful";
      status.title = "Confirmed successful";
      status.textContent = "✓";
      name.append(" ", status);
    }

    const scores = document.createElement("div");
    scores.className = "solution-scores";
    scores.append(
      this.createScore("PRICE", "price", solution.scores?.price, bestScores?.price),
      this.createScore("AVG CYCLES", "cycles", solution.scores?.cycles, bestScores?.cycles),
      this.createScore("FOOTPRINT", "footprint", solution.scores?.footprint, bestScores?.footprint),
      this.createScore("COMBINED", "combined", solution.scores?.combined, bestScores?.combined),
    );

    const actions = document.createElement("div");
    actions.className = "solution-row-actions";
    actions.append(
      this.createAction("DUPLICATE", `Duplicate ${solution.name}`, () =>
        options.onDuplicate(solution.id)
      ),
      this.createAction("EDIT", `Edit ${solution.name}`, () =>
        options.onEdit(solution.id)
      , "solution-primary-action"),
      this.createAction("DELETE", `Delete ${solution.name}`, () =>
        options.onDelete(solution.id)
      , "solution-delete-action"),
    );

    row.append(identity, scores, actions);
    return row;
  }

  private createAction(
    label: string,
    accessibleLabel: string,
    onClick: () => void,
    className?: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.ariaLabel = accessibleLabel;
    if (className !== undefined) {
      button.className = className;
    }
    button.addEventListener("click", onClick);
    return button;
  }

  private createScore(
    label: string,
    metric: ScoreMetric,
    scoreValue: number | undefined,
    bestValue: number | undefined,
  ): HTMLElement {
    const score = document.createElement("span");
    const heading = document.createElement("small");
    heading.textContent = label;
    const value = document.createElement("strong");
    value.textContent = scoreValue === undefined ? "—" : formatPuzzleScore(scoreValue);
    if (scoreValue !== undefined) {
      if (scoreValue === bestValue) {
        value.classList.add("best-score");
        score.title = "Personal best among saved solutions";
      }
      this.rankedScores.push({ element: value, metric, value: scoreValue });
    }
    score.append(heading, value);
    return score;
  }
}
