import type { GridRegion } from "./grid-region";
import type { World } from "../simulation/world";

/** Copies only player-owned cells and welds into another puzzle-case world. */
export function applyEditableSolution(
  target: World,
  solution: World,
  editableRegion: GridRegion,
): void {
  if (target.width !== solution.width || target.height !== solution.height) {
    throw new RangeError("Puzzle test world dimensions must match the solution");
  }

  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      if (!editableRegion.contains(x, y)) {
        continue;
      }
      target.place(x, y, solution.kindAt(x, y), solution.orientationAt(x, y));
      const componentState = solution.componentStateSnapshotAt(x, y);
      if (componentState !== null) {
        target.restoreComponentState(x, y, componentState);
      }
    }
  }

  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width - 1; x += 1) {
      if (editableRegion.containsEdge(x, y, x + 1, y)) {
        target.setWeld(x, y, x + 1, y, solution.isWelded(x, y, x + 1, y));
      }
    }
  }
  for (let y = 0; y < target.height - 1; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      if (editableRegion.containsEdge(x, y, x, y + 1)) {
        target.setWeld(x, y, x, y + 1, solution.isWelded(x, y, x, y + 1));
      }
    }
  }
}
