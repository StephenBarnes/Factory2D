import { describe, expect, it } from "vitest";

import { EditableRegionAuthoringState } from "../src/game/editable-region-authoring";
import { GridRegion } from "../src/game/grid-region";

function addRectangle(
  state: EditableRegionAuthoringState,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): void {
  state.beginRectangle(startX, startY);
  state.updateRectangle(endX, endY);
  expect(state.commitRectangle()).toBe(true);
}

describe("editable-region authoring", () => {
  it("normalizes an inclusive drag into a committed grid rectangle", () => {
    const state = new EditableRegionAuthoringState(6, 5);

    state.beginRectangle(4, 3);
    state.updateRectangle(1, 1);

    expect(state.region.rectangles).toEqual([]);
    expect(state.draftRectangle).toEqual({ x: 1, y: 1, width: 4, height: 3 });
    expect(state.commitRectangle()).toBe(true);
    expect(state.draftRectangle).toBeNull();
    expect(state.region.rectangles).toEqual([{ x: 1, y: 1, width: 4, height: 3 }]);
  });

  it("removes every committed rectangle overlapping the clicked cell", () => {
    const state = new EditableRegionAuthoringState(6, 5);
    addRectangle(state, 0, 0, 2, 2);
    addRectangle(state, 1, 1, 3, 3);
    addRectangle(state, 5, 4, 5, 4);

    expect(state.removeRectanglesAt(1, 1)).toBe(true);
    expect(state.region.rectangles).toEqual([{ x: 5, y: 4, width: 1, height: 1 }]);
    expect(state.removeRectanglesAt(0, 0)).toBe(false);
  });

  it("cancels a draft and clears committed regions when the board is replaced", () => {
    const state = new EditableRegionAuthoringState(6, 5);
    addRectangle(state, 0, 0, 2, 2);
    state.beginRectangle(4, 4);

    state.resetForBoard(2, 3);

    expect(state.region.rectangles).toEqual([]);
    expect(state.draftRectangle).toBeNull();
    expect(() => state.beginRectangle(2, 0)).toThrow("outside the board");
  });

  it("loads imported regions and clips them when the board shrinks", () => {
    const state = new EditableRegionAuthoringState(6, 5);
    state.replaceForBoard(
      6,
      5,
      new GridRegion([
        { x: 1, y: 1, width: 4, height: 3 },
        { x: 5, y: 4, width: 1, height: 1 },
      ]),
    );

    state.resizeForBoard(4, 3);

    expect(state.region.rectangles).toEqual([
      { x: 1, y: 1, width: 3, height: 2 },
    ]);
    expect(() =>
      state.replaceForBoard(
        4,
        3,
        new GridRegion([{ x: 3, y: 2, width: 2, height: 1 }]),
      )
    ).toThrow("fit within");
  });
});
