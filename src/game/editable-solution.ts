import type { GridRegion } from "./grid-region";
import type { World } from "../simulation/world";
import { TileKind } from "../simulation/tile";

/** Copies player-owned cells, welds, annotations, and display-only trace ordering. */
export function applyEditableSolution(
  target: World,
  solution: World,
  editableRegion: GridRegion,
): void {
  if (target.width !== solution.width || target.height !== solution.height) {
    throw new RangeError("Puzzle test world dimensions must match the solution");
  }

  target.setTextBoxes([
    ...target.textBoxes.filter((box) => box.owner === "author"),
    ...solution.textBoxes.filter((box) => box.owner === "player"),
  ]);

  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      if (!editableRegion.contains(x, y)) {
        copySignalOrder(target, solution, x, y);
        continue;
      }
      target.place(x, y, solution.kindAt(x, y), solution.orientationAt(x, y), solution.mirroredAt(x, y));
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

/** Fixed machinery keeps its configuration; only its presentation order is player-owned. */
function copySignalOrder(target: World, source: World, x: number, y: number): void {
  const kind = source.kindAt(x, y);
  if (target.kindAt(x, y) !== kind) return;
  if (kind === TileKind.Monitor || kind === TileKind.Grapher) {
    const state = source.componentStateSnapshotAt(x, y);
    if (state?.type !== "monitor" && state?.type !== "grapher") {
      throw new Error(`Signal source at (${x}, ${y}) is missing its component state`);
    }
    target.configureSignalOrder(x, y, state.order);
  } else if (kind === TileKind.RuneArray) {
    const targetInner = target.runeArrayWorldAtIndex(y * target.width + x);
    const sourceInner = source.runeArrayWorldAtIndex(y * source.width + x);
    if (targetInner.width !== sourceInner.width || targetInner.height !== sourceInner.height) return;
    for (let innerY = 0; innerY < targetInner.height; innerY += 1) {
      for (let innerX = 0; innerX < targetInner.width; innerX += 1) {
        copySignalOrder(targetInner, sourceInner, innerX, innerY);
      }
    }
  }
}
