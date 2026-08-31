import {
  isPuzzleUnlocked,
  puzzleById,
  type PuzzleDefinition,
  type PuzzleId,
} from "../game/puzzles";

export interface MainMenuOptions {
  readonly puzzles: readonly PuzzleDefinition[];
  readonly completedPuzzleIds: ReadonlySet<PuzzleId>;
  readonly onSelectPuzzle: (id: PuzzleId) => void;
}

export function populatePuzzleMap(container: HTMLElement, options: MainMenuOptions): void {
  const fragment = document.createDocumentFragment();

  for (const [index, puzzle] of options.puzzles.entries()) {
    const unlocked = isPuzzleUnlocked(puzzle, options.completedPuzzleIds);
    const completed = options.completedPuzzleIds.has(puzzle.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "puzzle-node";
    button.disabled = !unlocked;
    button.dataset.state = completed ? "completed" : unlocked ? "unlocked" : "locked";
    button.style.setProperty("--map-step", String(index));

    const number = document.createElement("span");
    number.className = "puzzle-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const details = document.createElement("span");
    details.className = "puzzle-details";

    const name = document.createElement("strong");
    name.textContent = puzzle.name;
    details.append(name);

    const description = document.createElement("small");
    description.textContent = puzzle.description;
    details.append(description);

    const status = document.createElement("span");
    status.className = "puzzle-status";
    if (completed) {
      status.textContent = "COMPLETE";
    } else if (unlocked) {
      status.textContent = "AVAILABLE";
    } else {
      const prerequisiteNames = puzzle.prerequisitePuzzleIds
        .map((id) => puzzleById(id).name)
        .join(", ");
      status.textContent = `LOCKED · COMPLETE ${prerequisiteNames.toUpperCase()}`;
    }

    button.append(number, details, status);
    if (unlocked) {
      button.addEventListener("click", () => options.onSelectPuzzle(puzzle.id));
    }
    fragment.append(button);
  }

  container.replaceChildren(fragment);
}
