import type { SavedPuzzleSolution } from "../game/puzzle-solutions";
import type { PuzzleDefinition } from "../game/puzzles";

export interface PuzzleInfoOptions {
  readonly puzzle: PuzzleDefinition;
  readonly solutions: readonly SavedPuzzleSolution[];
  readonly selectedSolutionId: string | null;
  readonly onBack: () => void;
  readonly onCreate: () => void;
  readonly onSelect: (solutionId: string) => void;
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
  private readonly duplicateButton: HTMLButtonElement;
  private readonly editButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;

  constructor(root: HTMLElement) {
    this.title = requiredDescendant(root, "#puzzle-info-title");
    this.description = requiredDescendant(root, "#puzzle-info-description");
    this.goal = requiredDescendant(root, "#puzzle-info-goal");
    this.features = requiredDescendant(root, "#puzzle-info-features");
    this.solutionList = requiredDescendant(root, "#solution-list");
    this.emptySolutions = requiredDescendant(root, "#empty-solutions");
    this.backButton = requiredDescendant(root, "#puzzle-info-back-button");
    this.newButton = requiredDescendant(root, "#new-solution-button");
    this.duplicateButton = requiredDescendant(root, "#duplicate-solution-button");
    this.editButton = requiredDescendant(root, "#edit-solution-button");
    this.deleteButton = requiredDescendant(root, "#delete-solution-button");
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

    const solutionRows = options.solutions.map((solution) =>
      this.createSolutionRow(solution, solution.id === options.selectedSolutionId, options),
    );
    this.solutionList.replaceChildren(...solutionRows);
    this.emptySolutions.hidden = solutionRows.length !== 0;

    const hasSelection = options.selectedSolutionId !== null;
    this.duplicateButton.disabled = !hasSelection;
    this.editButton.disabled = !hasSelection;
    this.deleteButton.disabled = !hasSelection;

    this.backButton.onclick = options.onBack;
    this.newButton.onclick = options.onCreate;
    this.duplicateButton.onclick = () => {
      if (options.selectedSolutionId !== null) {
        options.onDuplicate(options.selectedSolutionId);
      }
    };
    this.editButton.onclick = () => {
      if (options.selectedSolutionId !== null) {
        options.onEdit(options.selectedSolutionId);
      }
    };
    this.deleteButton.onclick = () => {
      if (options.selectedSolutionId !== null) {
        options.onDelete(options.selectedSolutionId);
      }
    };
  }

  private createSolutionRow(
    solution: SavedPuzzleSolution,
    selected: boolean,
    options: PuzzleInfoOptions,
  ): HTMLButtonElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "solution-row";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected));

    const identity = document.createElement("span");
    identity.className = "solution-identity";
    const name = document.createElement("strong");
    name.textContent = solution.name;
    const status = document.createElement("small");
    status.textContent = "Saved workshop design";
    identity.append(name, status);

    const scores = document.createElement("span");
    scores.className = "solution-scores";
    scores.append(
      this.createPlaceholderScore("PRICE"),
      this.createPlaceholderScore("CYCLES"),
      this.createPlaceholderScore("FOOTPRINT"),
    );

    row.append(identity, scores);
    row.addEventListener("click", () => options.onSelect(solution.id));
    row.addEventListener("dblclick", () => options.onEdit(solution.id));
    return row;
  }

  private createPlaceholderScore(label: string): HTMLElement {
    const score = document.createElement("span");
    const heading = document.createElement("small");
    heading.textContent = label;
    const value = document.createElement("strong");
    value.textContent = "—";
    score.append(heading, value);
    return score;
  }
}
