import { describe, expect, it } from "vitest";

import { GridRegion } from "../src/game/grid-region";
import { TileSelectionState } from "../src/game/tile-selection";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

const ALLOW_CELL = () => true;
const ALLOW_KIND = () => true;

function selectRectangle(
  selection: TileSelectionState,
  world: World,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  editableRegion: GridRegion | null = null,
): void {
  selection.beginSelection(startX, startY);
  selection.updateSelection(endX, endY);
  expect(selection.finishSelection(world, editableRegion)).toBe(true);
}

describe("tile selection", () => {
  it("moves overlapping tiles as one edit and preserves configuration and internal welds", () => {
    const world = new World(6, 5);
    world.place(1, 1, TileKind.Stone);
    world.place(2, 1, TileKind.Delay, Direction.Right);
    world.configureNumericComponent(2, 1, 7);
    world.setWeld(1, 1, 2, 1, true);
    world.place(3, 2, TileKind.Iron);
    const selection = new TileSelectionState(world.width, world.height);
    selectRectangle(selection, world, 1, 1, 2, 1);

    expect(selection.beginMove(1, 1)).toBe(true);
    expect(selection.updateMove(3, 2)).toBe(true);
    selection.finishMove();
    const result = selection.commit(world, ALLOW_CELL, ALLOW_KIND);

    expect(result).toEqual({ accepted: true, changed: true });
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(3, 2)).toBe(TileKind.Stone);
    expect(world.kindAt(4, 2)).toBe(TileKind.Delay);
    expect(world.orientationAt(4, 2)).toBe(Direction.Right);
    expect(world.componentStateSnapshotAt(4, 2)).toMatchObject({ type: "delay", length: 7 });
    expect(world.isWelded(3, 2, 4, 2)).toBe(true);
  });

  it("rotates geometry, tile orientation, and welds around the selection bounds", () => {
    const world = new World(5, 5);
    world.place(1, 1, TileKind.Sensor, Direction.Up);
    world.place(2, 1, TileKind.Stone);
    world.setWeld(1, 1, 2, 1, true);
    const selection = new TileSelectionState(world.width, world.height);
    selectRectangle(selection, world, 1, 1, 2, 1);

    expect(selection.rotateTo(Direction.Right)).toBe(true);
    expect(selection.commit(world, ALLOW_CELL, ALLOW_KIND)).toEqual({
      accepted: true,
      changed: true,
    });

    expect(world.kindAt(1, 1)).toBe(TileKind.Sensor);
    expect(world.orientationAt(1, 1)).toBe(Direction.Right);
    expect(world.kindAt(1, 2)).toBe(TileKind.Stone);
    expect(world.isWelded(1, 1, 1, 2)).toBe(true);
    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
  });

  it("clips the initial selection to editable regions and rejects an invalid destination", () => {
    const world = new World(6, 3);
    world.place(1, 0, TileKind.Stone);
    world.place(2, 0, TileKind.Iron);
    const editableRegion = new GridRegion([
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 4, y: 0, width: 2, height: 2 },
    ]);
    const selection = new TileSelectionState(world.width, world.height);
    selectRectangle(selection, world, 0, 0, 2, 0, editableRegion);

    expect(selection.beginMove(1, 0)).toBe(true);
    selection.updateMove(3, 0);
    selection.finishMove();
    expect(selection.overlay(
      (x, y) => editableRegion.contains(x, y),
      ALLOW_KIND,
    )?.valid).toBe(false);
    expect(selection.commit(
      world,
      (x, y) => editableRegion.contains(x, y),
      ALLOW_KIND,
    )).toEqual({ accepted: false, changed: false });
    expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
    expect(world.kindAt(2, 0)).toBe(TileKind.Iron);

    selectRectangle(selection, world, 0, 0, 1, 0, editableRegion);
    selection.beginMove(1, 0);
    selection.updateMove(4, 0);
    selection.finishMove();
    expect(selection.commit(
      world,
      (x, y) => editableRegion.contains(x, y),
      ALLOW_KIND,
    )).toEqual({ accepted: true, changed: true });
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
    expect(world.kindAt(2, 0)).toBe(TileKind.Iron);
    expect(world.kindAt(4, 0)).toBe(TileKind.Stone);
  });

  it("copies and pastes a selection without removing the source", () => {
    const world = new World(5, 4);
    world.place(1, 1, TileKind.Furnace, Direction.Left);
    const selection = new TileSelectionState(world.width, world.height);
    selectRectangle(selection, world, 1, 1, 1, 1);

    expect(selection.copy()).toBe(true);
    expect(selection.commit(world, ALLOW_CELL, ALLOW_KIND)).toEqual({
      accepted: true,
      changed: false,
    });
    expect(selection.paste(3, 2)).toBe(true);
    expect(selection.commit(world, ALLOW_CELL, ALLOW_KIND)).toEqual({
      accepted: true,
      changed: true,
    });

    expect(world.kindAt(1, 1)).toBe(TileKind.Furnace);
    expect(world.kindAt(3, 2)).toBe(TileKind.Furnace);
    expect(world.orientationAt(3, 2)).toBe(Direction.Left);
  });

  it("deletes only occupied selected cells", () => {
    const world = new World(4, 3);
    world.place(0, 0, TileKind.Stone);
    world.place(2, 0, TileKind.Iron);
    const selection = new TileSelectionState(world.width, world.height);
    selectRectangle(selection, world, 0, 0, 1, 1);

    expect(selection.deleteFrom(world)).toBe(true);
    expect(world.kindAt(0, 0)).toBe(TileKind.Empty);
    expect(world.kindAt(2, 0)).toBe(TileKind.Iron);
    expect(selection.active).toBe(false);
  });
  it("describes transformed internal welds in the selection preview", () => {
    const world = new World(5, 5);
    world.place(1, 1, TileKind.Stone);
    world.place(2, 1, TileKind.Iron);
    world.setWeld(1, 1, 2, 1, true);
    const selection = new TileSelectionState(world.width, world.height);
    selectRectangle(selection, world, 1, 1, 2, 1);

    let preview = selection.overlay(ALLOW_CELL, ALLOW_KIND)?.previewCells;
    expect(preview).toEqual([
      expect.objectContaining({ x: 1, y: 1, weldRight: true, weldDown: false }),
      expect.objectContaining({ x: 2, y: 1, weldRight: false, weldDown: false }),
    ]);

    selection.rotateTo(Direction.Right);
    preview = selection.overlay(ALLOW_CELL, ALLOW_KIND)?.previewCells;
    expect(preview).toEqual([
      expect.objectContaining({ x: 1, y: 1, weldRight: false, weldDown: true }),
      expect.objectContaining({ x: 1, y: 2, weldRight: false, weldDown: false }),
    ]);
  });

  it("flips geometry, tile orientation, and welds vertically", () => {
    const world = new World(4, 4);
    world.place(1, 1, TileKind.Sensor, Direction.Up);
    world.place(1, 2, TileKind.Stone);
    world.setWeld(1, 1, 1, 2, true);
    const selection = new TileSelectionState(world.width, world.height);
    selectRectangle(selection, world, 1, 1, 1, 2);

    expect(selection.flipVertically()).toBe(true);
    expect(selection.commit(world, ALLOW_CELL, ALLOW_KIND)).toEqual({
      accepted: true,
      changed: true,
    });

    expect(world.kindAt(1, 1)).toBe(TileKind.Stone);
    expect(world.kindAt(1, 2)).toBe(TileKind.Sensor);
    expect(world.orientationAt(1, 2)).toBe(Direction.Down);
    expect(world.isWelded(1, 1, 1, 2)).toBe(true);
  });

  it("selects the occupied-cell bounds inside the editable region", () => {
    const world = new World(6, 5);
    world.place(0, 0, TileKind.Stone);
    world.place(2, 1, TileKind.Iron);
    world.place(4, 3, TileKind.Stone);
    const editableRegion = new GridRegion([{ x: 1, y: 1, width: 4, height: 3 }]);
    const selection = new TileSelectionState(world.width, world.height);

    expect(selection.selectOccupiedBounds(world, editableRegion)).toBe(true);
    expect(selection.overlay(ALLOW_CELL, ALLOW_KIND)?.region.rectangles).toEqual([
      { x: 2, y: 1, width: 3, height: 3 },
    ]);
    expect(selection.overlay(ALLOW_CELL, ALLOW_KIND)?.previewCells).toEqual([
      expect.objectContaining({ x: 2, y: 1, kind: TileKind.Iron }),
      expect.objectContaining({ x: 4, y: 3, kind: TileKind.Stone }),
    ]);

    world.clear();
    expect(selection.selectOccupiedBounds(world, editableRegion)).toBe(false);
    expect(selection.active).toBe(false);
  });
});

describe("snippet capture and placement", () => {
  it("captures the transformed selection cropped to its occupied cells", () => {
    const world = new World(7, 6);
    world.place(2, 2, TileKind.Sensor, Direction.Up);
    world.place(3, 2, TileKind.Stone);
    world.place(3, 3, TileKind.Delay, Direction.Right);
    world.configureNumericComponent(3, 3, 4);
    world.setWeld(2, 2, 3, 2, true);
    world.setWeld(3, 2, 3, 3, true);
    const selection = new TileSelectionState(world.width, world.height);
    selectRectangle(selection, world, 0, 0, 5, 5);
    expect(selection.rotateTo(Direction.Right)).toBe(true);

    const captured = selection.captureWorld();
    expect(captured).not.toBeNull();
    if (captured === null) {
      return;
    }
    expect(captured.width).toBe(2);
    expect(captured.height).toBe(2);
    expect(captured.kindAt(1, 0)).toBe(TileKind.Sensor);
    expect(captured.orientationAt(1, 0)).toBe(Direction.Right);
    expect(captured.kindAt(1, 1)).toBe(TileKind.Stone);
    expect(captured.kindAt(0, 1)).toBe(TileKind.Delay);
    expect(captured.orientationAt(0, 1)).toBe(Direction.Down);
    expect(captured.componentStateSnapshotAt(0, 1)).toMatchObject({ type: "delay", length: 4 });
    expect(captured.isWelded(1, 0, 1, 1)).toBe(true);
    expect(captured.isWelded(0, 1, 1, 1)).toBe(true);
    expect(captured.kindAt(0, 0)).toBe(TileKind.Empty);
    expect(world.kindAt(2, 2)).toBe(TileKind.Sensor);
    expect(selection.active).toBe(true);
  });

  it("returns null without an active selection or occupied cells", () => {
    const world = new World(4, 4);
    const selection = new TileSelectionState(world.width, world.height);
    expect(selection.captureWorld()).toBeNull();
    selection.beginSelection(0, 0);
    selection.updateSelection(1, 1);
    expect(selection.finishSelection(world, null)).toBe(true);
    expect(selection.captureWorld()).toBeNull();
  });

  it("floats a world as a pasted selection that commits without clearing a source", () => {
    const snippet = new World(2, 1);
    snippet.place(0, 0, TileKind.Stone);
    snippet.place(1, 0, TileKind.Iron);
    snippet.setWeld(0, 0, 1, 0, true);
    const world = new World(5, 4);
    world.place(0, 0, TileKind.Sand);
    const selection = new TileSelectionState(world.width, world.height);

    expect(selection.pasteWorld(snippet, 4, 3)).toBe(true);
    const overlay = selection.overlay(ALLOW_CELL, ALLOW_KIND);
    expect(overlay?.sourceRegion).toBeNull();
    expect(overlay?.region.rectangles).toEqual([{ x: 3, y: 3, width: 2, height: 1 }]);

    expect(selection.beginMove(4, 3)).toBe(true);
    expect(selection.updateMove(3, 2)).toBe(true);
    selection.finishMove();
    expect(selection.commit(world, ALLOW_CELL, ALLOW_KIND)).toEqual({
      accepted: true,
      changed: true,
    });
    expect(world.kindAt(0, 0)).toBe(TileKind.Sand);
    expect(world.kindAt(2, 2)).toBe(TileKind.Stone);
    expect(world.kindAt(3, 2)).toBe(TileKind.Iron);
    expect(world.isWelded(2, 2, 3, 2)).toBe(true);
  });

  it("rejects empty or oversized worlds and rotations that would not fit", () => {
    const wide = new World(4, 1);
    wide.place(0, 0, TileKind.Stone);
    wide.place(3, 0, TileKind.Stone);
    const selection = new TileSelectionState(4, 2);
    expect(selection.pasteWorld(new World(2, 2), 0, 0)).toBe(false);
    expect(selection.pasteWorld(new World(5, 1), 0, 0)).toBe(false);
    expect(selection.active).toBe(false);

    expect(selection.pasteWorld(wide, 0, 0)).toBe(true);
    expect(selection.rotateClockwise()).toBe(false);
    expect(selection.rotateTo(Direction.Left)).toBe(false);
    expect(selection.rotateTo(Direction.Down)).toBe(true);
    expect(selection.overlay(ALLOW_CELL, ALLOW_KIND)?.region.rectangles).toEqual([
      { x: 0, y: 0, width: 4, height: 1 },
    ]);
  });
});
