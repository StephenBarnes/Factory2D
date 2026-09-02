import type { SavedPuzzleSolution } from "../game/puzzle-solutions";
import type { PuzzleDefinition } from "../game/puzzles";

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
  private readonly goal: HTMLElement;
  private readonly features: HTMLUListElement;
  private readonly solutionList: HTMLElement;
  private readonly emptySolutions: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly newButton: HTMLButtonElement;

  constructor(root: HTMLElement) {
    this.title = requiredDescendant(root, "#puzzle-info-title");
    this.description = requiredDescendant(root, "#puzzle-info-description");
    this.goal = requiredDescendant(root, "#puzzle-info-goal");
    this.features = requiredDescendant(root, "#puzzle-info-features");
    this.solutionList = requiredDescendant(root, "#solution-list");
    this.emptySolutions = requiredDescendant(root, "#empty-solutions");
    this.backButton = requiredDescendant(root, "#puzzle-info-back-button");
    this.newButton = requiredDescendant(root, "#new-solution-button");
  }

  render(options: PuzzleInfoOptions): void {
    this.title.textContent = options.puzzle.name;
    this.description.textContent = options.puzzle.description;
    this.goal.textContent = options.puzzle.goal;
    this.features.replaceChildren(
      ...options.puzzle.features.map((feature) => {
        const item = document.createElement("li");
        item.textContent = feature;
        return item;
      }),
    );

    let bestSolution: SavedPuzzleSolution | null = null;
    let bestCombinedScore = Number.POSITIVE_INFINITY;
    for (const solution of options.solutions) {
      if (solution.scores !== null && solution.scores.combined < bestCombinedScore) {
        bestSolution = solution;
        bestCombinedScore = solution.scores.combined;
      }
    }

    const solutionRows = options.solutions.map((solution) =>
      this.createSolutionRow(solution, solution === bestSolution, options),
    );
    this.solutionList.replaceChildren(...solutionRows);
    this.emptySolutions.hidden = solutionRows.length !== 0;

    this.backButton.onclick = options.onBack;
    this.newButton.onclick = options.onCreate;
  }

  private createSolutionRow(
    solution: SavedPuzzleSolution,
    isBest: boolean,
    options: PuzzleInfoOptions,
  ): HTMLElement {
    const row = document.createElement("article");
    row.className = "solution-row";
    row.setAttribute("role", "listitem");
    if (isBest) {
      row.classList.add("best-score");
      row.dataset.bestScore = "true";
    }

    const identity = document.createElement("div");
    identity.className = "solution-identity";
    const name = document.createElement("strong");
    name.textContent = solution.name;
    const status = document.createElement("small");
    status.className = solution.scores === null ? "unconfirmed" : "confirmed";
    status.textContent = solution.scores === null
      ? "Not yet confirmed"
      : "Confirmed successful";
    identity.append(name, status);

    const scores = document.createElement("div");
    scores.className = "solution-scores";
    scores.append(
      this.createScore("PRICE", solution.scores?.price),
      this.createScore("CYCLES", solution.scores?.cycles),
      this.createScore("FOOTPRINT", solution.scores?.footprint),
      this.createScore("COMBINED", solution.scores?.combined),
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

  private createScore(label: string, scoreValue: number | undefined): HTMLElement {
    const score = document.createElement("span");
    const heading = document.createElement("small");
    heading.textContent = label;
    const value = document.createElement("strong");
    value.textContent = scoreValue === undefined ? "—" : String(scoreValue);
    score.append(heading, value);
    return score;
  }
}
