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
});
