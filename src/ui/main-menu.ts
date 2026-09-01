import {
  isPuzzleGroupUnlocked,
  isPuzzleUnlocked,
  type PuzzleDefinition,
  type PuzzleId,
} from "../game/puzzles";
import { PUZZLE_GROUPS } from "../game/puzzle-groups";

export interface MainMenuOptions {
  readonly puzzles: readonly PuzzleDefinition[];
  readonly completedPuzzleIds: ReadonlySet<PuzzleId>;
  readonly onSelectPuzzle: (id: PuzzleId) => void;
}

export function populatePuzzleMap(container: HTMLElement, options: MainMenuOptions): void {
  const fragment = document.createDocumentFragment();

  const gemstoneCount = document.createElement("p");
  gemstoneCount.className = "gemstone-count";
  const gemstoneIcon = document.createElement("span");
  gemstoneIcon.ariaHidden = "true";
  gemstoneIcon.textContent = "◆";
  const gemstoneLabel = options.completedPuzzleIds.size === 1 ? "GEMSTONE" : "GEMSTONES";
  gemstoneCount.append(
    gemstoneIcon,
    ` ${options.completedPuzzleIds.size} ${gemstoneLabel}`,
  );
  fragment.append(gemstoneCount);

  for (const group of PUZZLE_GROUPS) {
    const groupPuzzles = options.puzzles.filter((puzzle) => puzzle.groupId === group.id);
    if (groupPuzzles.length === 0) {
      continue;
    }

    const completedCount = groupPuzzles.reduce(
      (count, puzzle) => count + (options.completedPuzzleIds.has(puzzle.id) ? 1 : 0),
      0,
    );
    const unlocked = isPuzzleGroupUnlocked(group, options.completedPuzzleIds);
    const allCompleted = completedCount === groupPuzzles.length;
    const section = document.createElement("details");
    section.className = "puzzle-group";
    section.dataset.state = allCompleted ? "completed" : unlocked ? "unlocked" : "locked";
    section.open = unlocked && !allCompleted;

    const heading = document.createElement("summary");
    heading.className = "puzzle-group-heading";

    const groupName = document.createElement("strong");
    groupName.textContent = group.name;
    const groupStatus = document.createElement("span");
    groupStatus.className = "puzzle-group-status";
    groupStatus.textContent = unlocked
      ? `${completedCount}/${groupPuzzles.length} COMPLETE`
      : `LOCKED · ${group.gemstoneThreshold} GEMSTONES REQUIRED`;
    heading.append(groupName, groupStatus);
    section.append(heading);

    const puzzleList = document.createElement("div");
    puzzleList.className = "puzzle-group-list";
    for (const [index, puzzle] of groupPuzzles.entries()) {
      const puzzleUnlocked = isPuzzleUnlocked(
        puzzle,
        options.completedPuzzleIds,
        options.puzzles,
      );
      const completed = options.completedPuzzleIds.has(puzzle.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "puzzle-node";
      button.disabled = !puzzleUnlocked;
      button.dataset.state = completed ? "completed" : puzzleUnlocked ? "unlocked" : "locked";

      const number = document.createElement("span");
      number.className = "puzzle-number";
      number.textContent = String(index + 1).padStart(2, "0");

      const name = document.createElement("strong");
      name.className = "puzzle-name";
      name.textContent = puzzle.name;

      const status = document.createElement("span");
      status.className = "puzzle-status";
      status.textContent = completed ? "◆ COMPLETE" : puzzleUnlocked ? "AVAILABLE" : "LOCKED";

      button.append(number, name, status);
      if (puzzleUnlocked) {
        button.addEventListener("click", () => options.onSelectPuzzle(puzzle.id));
      }
      puzzleList.append(button);
    }
    section.append(puzzleList);
    fragment.append(section);
  }

  container.replaceChildren(fragment);
}
