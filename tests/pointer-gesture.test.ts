import { describe, expect, it } from "vitest";

import {
  exceedsPanDragThreshold,
  pointerGesture,
  shouldWeldPlacedTile,
} from "../src/render/pointer-gesture";

describe("board pointer gestures", () => {
  it("reserves the middle button for click-to-pick or drag-to-pan", () => {
    expect(pointerGesture(1, false)).toBe("pick-or-pan");
  });

  it("uses Alt-right-drag for panning and plain right-drag for editing", () => {
    expect(pointerGesture(2, true)).toBe("pan");
    expect(pointerGesture(2, false)).toBe("edit");
  });

  it("keeps left drag editing and ignores unsupported buttons", () => {
    expect(pointerGesture(0, true)).toBe("edit");
    expect(pointerGesture(3, false)).toBeNull();
  });
  it("welds placed tiles only for Shift-left placement gestures", () => {
    expect(shouldWeldPlacedTile(0, true)).toBe(true);
    expect(shouldWeldPlacedTile(0, false)).toBe(false);
    expect(shouldWeldPlacedTile(2, true)).toBe(false);
  });


  it("requires a four-pixel middle-button movement before panning", () => {
    expect(exceedsPanDragThreshold(2, 3)).toBe(false);
    expect(exceedsPanDragThreshold(4, 0)).toBe(true);
    expect(exceedsPanDragThreshold(-4, 0)).toBe(true);
  });
});
