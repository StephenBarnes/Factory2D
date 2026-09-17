import { GridRegion, type GridRectangle } from "./grid-region";
import {
  transformComponentSnapshot,
  type ConfigurableComponentSnapshot,
} from "../simulation/configurable-components";
import {
  Direction,
  flipDirectionHorizontally,
  flipDirectionVertically,
  orientationForKind,
  mirroringForKind,
  TileKind,
} from "../simulation/tile";
import { World } from "../simulation/world";

export interface SelectionPreviewCell {
  readonly x: number;
  readonly y: number;
  readonly kind: TileKind;
  readonly orientation: Direction;
  readonly mirrored: boolean;
  readonly componentState: ConfigurableComponentSnapshot | null;
  readonly weldRight: boolean;
  readonly weldDown: boolean;
}

export interface TileSelectionOverlay {
  readonly region: GridRegion;
  readonly sourceRegion: GridRegion | null;
  readonly previewCells: readonly SelectionPreviewCell[];
  readonly valid: boolean;
}

export interface TileSelectionCommitResult {
  readonly accepted: boolean;
  readonly changed: boolean;
}

interface GridCell {
  readonly x: number;
  readonly y: number;
}

interface OccupiedSelectionCell extends GridCell {
  readonly kind: TileKind;
  readonly orientation: Direction;
  readonly mirrored: boolean;
  readonly componentState: ConfigurableComponentSnapshot | null;
}

interface SelectionContent {
  readonly sourceWorld: World;
  readonly region: GridRegion;
  readonly bounds: GridRectangle;
  readonly occupiedCells: readonly OccupiedSelectionCell[];
}

interface ClipboardSelection {
  readonly content: SelectionContent;
  readonly quarterTurns: number;
  readonly flippedHorizontally: boolean;
  readonly flippedVertically: boolean;
}

interface ActiveSelection {
  readonly content: SelectionContent;
  readonly removesSourceOnCommit: boolean;
  quarterTurns: number;
  flippedHorizontally: boolean;
  flippedVertically: boolean;
  originX: number;
  originY: number;
  dragAnchorX: number;
  dragAnchorY: number;
  dragOriginX: number;
  dragOriginY: number;
  moving: boolean;
}

interface MappedSelectionCell extends OccupiedSelectionCell {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly destinationX: number;
  readonly destinationY: number;
}

export type SelectionCellPredicate = (x: number, y: number) => boolean;
export type SelectionKindPredicate = (kind: TileKind) => boolean;

/** Rectangular tile-selection, floating move, and in-memory clipboard state. */
export class TileSelectionState {
  private readonly boardWidth: number;
  private readonly boardHeight: number;
  private draftStart: GridCell | null = null;
  private draftEnd: GridCell | null = null;
  private activeSelection: ActiveSelection | null = null;
  private clipboardSelection: ClipboardSelection | null = null;

  constructor(boardWidth: number, boardHeight: number) {
    if (
      !Number.isInteger(boardWidth) ||
      !Number.isInteger(boardHeight) ||
      boardWidth <= 0 ||
      boardHeight <= 0
    ) {
      throw new RangeError("Selection board dimensions must be positive integers");
    }
    this.boardWidth = boardWidth;
    this.boardHeight = boardHeight;
  }

  get active(): boolean {
    return this.activeSelection !== null;
  }

  get drafting(): boolean {
    return this.draftStart !== null;
  }

  draftRegion(editableRegion: GridRegion | null): GridRegion | null {
    const draft = this.draftRectangle;
    return draft === null ? null : intersectRegion(draft, editableRegion);
  }

  get hasClipboard(): boolean {
    return this.clipboardSelection !== null;
  }

  get draftRectangle(): GridRectangle | null {
    if (this.draftStart === null || this.draftEnd === null) {
      return null;
    }
    return rectangleBetween(this.draftStart, this.draftEnd);
  }

  beginSelection(x: number, y: number): void {
    this.requireCell(x, y);
    this.draftStart = { x, y };
    this.draftEnd = { x, y };
  }

  updateSelection(x: number, y: number): boolean {
    if (this.draftStart === null) {
      return false;
    }
    this.requireCell(x, y);
    if (this.draftEnd?.x === x && this.draftEnd.y === y) {
      return false;
    }
    this.draftEnd = { x, y };
    return true;
  }

  finishSelection(world: World, editableRegion: GridRegion | null): boolean {
    const draft = this.draftRectangle;
    this.cancelDraft();
    if (draft === null) {
      return false;
    }
    const region = intersectRegion(draft, editableRegion);
    const content = captureSelectionContent(world, region);
    if (content === null) {
      this.activeSelection = null;
      return false;
    }
    this.activeSelection = {
      content,
      removesSourceOnCommit: true,
      quarterTurns: 0,
      flippedHorizontally: false,
      flippedVertically: false,
      originX: content.bounds.x,
      originY: content.bounds.y,
      dragAnchorX: 0,
      dragAnchorY: 0,
      dragOriginX: content.bounds.x,
      dragOriginY: content.bounds.y,
      moving: false,
    };
    return true;
  }

  selectOccupiedBounds(world: World, editableRegion: GridRegion | null): boolean {
    let left = this.boardWidth;
    let top = this.boardHeight;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < this.boardHeight; y += 1) {
      for (let x = 0; x < this.boardWidth; x += 1) {
        if (
          (editableRegion === null || editableRegion.contains(x, y)) &&
          world.kindAt(x, y) !== TileKind.Empty
        ) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left || bottom < top) {
      this.clear();
      return false;
    }
    this.beginSelection(left, top);
    this.updateSelection(right, bottom);
    return this.finishSelection(world, editableRegion);
  }

  cancelDraft(): void {
    this.draftStart = null;
    this.draftEnd = null;
  }

  containsActiveCell(x: number, y: number): boolean {
    const active = this.activeSelection;
    return active !== null && transformedRegion(active).contains(x, y);
  }

  beginMove(x: number, y: number): boolean {
    const active = this.activeSelection;
    if (active === null || !this.containsActiveCell(x, y)) {
      return false;
    }
    active.dragAnchorX = x;
    active.dragAnchorY = y;
    active.dragOriginX = active.originX;
    active.dragOriginY = active.originY;
    active.moving = true;
    return true;
  }

  updateMove(x: number, y: number): boolean {
    const active = this.activeSelection;
    if (active === null || !active.moving) {
      return false;
    }
    const nextX = active.dragOriginX + x - active.dragAnchorX;
    const nextY = active.dragOriginY + y - active.dragAnchorY;
    return this.setOrigin(active, nextX, nextY);
  }

  finishMove(): void {
    if (this.activeSelection !== null) {
      this.activeSelection.moving = false;
    }
  }

  rotateTo(direction: Direction): boolean {
    const active = this.activeSelection;
    if (active === null || active.quarterTurns === direction) {
      return false;
    }
    return this.setQuarterTurns(active, direction);
  }

  rotateClockwise(): boolean {
    const active = this.activeSelection;
    if (active === null) {
      return false;
    }
    return this.setQuarterTurns(active, ((active.quarterTurns + 1) & 3) as Direction);
  }

  flipHorizontally(): boolean {
    const active = this.activeSelection;
    if (active === null) {
      return false;
    }
    active.flippedHorizontally = !active.flippedHorizontally;
    return true;
  }

  flipVertically(): boolean {
    const active = this.activeSelection;
    if (active === null) {
      return false;
    }
    active.flippedVertically = !active.flippedVertically;
    return true;
  }

  copy(): boolean {
    const active = this.activeSelection;
    if (active === null) {
      return false;
    }
    this.clipboardSelection = {
      content: active.content,
      quarterTurns: active.quarterTurns,
      flippedHorizontally: active.flippedHorizontally,
      flippedVertically: active.flippedVertically,
    };
    return true;
  }

  paste(anchorX: number, anchorY: number): boolean {
    const clipboard = this.clipboardSelection;
    if (clipboard === null) {
      return false;
    }
    const active: ActiveSelection = {
      content: clipboard.content,
      removesSourceOnCommit: false,
      quarterTurns: clipboard.quarterTurns,
      flippedHorizontally: clipboard.flippedHorizontally,
      flippedVertically: clipboard.flippedVertically,
      originX: anchorX,
      originY: anchorY,
      dragAnchorX: 0,
      dragAnchorY: 0,
      dragOriginX: anchorX,
      dragOriginY: anchorY,
      moving: false,
    };
    this.activeSelection = active;
    this.setOrigin(active, anchorX, anchorY);
    return true;
  }

  /**
   * Floats a copy of every occupied cell of `source` as a new pasted selection
   * whose top-left corner is anchored at the given cell, clamped to the board.
   * Rejects sources larger than the board in either dimension.
   */
  pasteWorld(source: World, anchorX: number, anchorY: number): boolean {
    if (source.width > this.boardWidth || source.height > this.boardHeight) {
      return false;
    }
    const content = captureSelectionContent(
      source,
      new GridRegion([{ x: 0, y: 0, width: source.width, height: source.height }]),
    );
    if (content === null || content.occupiedCells.length === 0) {
      return false;
    }
    const active: ActiveSelection = {
      content,
      removesSourceOnCommit: false,
      quarterTurns: 0,
      flippedHorizontally: false,
      flippedVertically: false,
      originX: anchorX,
      originY: anchorY,
      dragAnchorX: 0,
      dragAnchorY: 0,
      dragOriginX: anchorX,
      dragOriginY: anchorY,
      moving: false,
    };
    this.activeSelection = active;
    this.cancelDraft();
    this.setOrigin(active, anchorX, anchorY);
    return true;
  }

  /**
   * Copies the transformed active selection into a standalone world cropped to
   * its occupied bounds, preserving orientations, configuration, and internal
   * welds. Returns null without an active selection or occupied cells.
   */
  captureWorld(): World | null {
    const active = this.activeSelection;
    if (active === null) {
      return null;
    }
    const mappedCells = mapOccupiedCells(active);
    if (mappedCells.length === 0) {
      return null;
    }
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const cell of mappedCells) {
      left = Math.min(left, cell.destinationX);
      top = Math.min(top, cell.destinationY);
      right = Math.max(right, cell.destinationX);
      bottom = Math.max(bottom, cell.destinationY);
    }
    const world = new World(right - left + 1, bottom - top + 1);
    for (const cell of mappedCells) {
      world.place(cell.destinationX - left, cell.destinationY - top, cell.kind, cell.orientation, cell.mirrored);
      if (cell.componentState !== null) {
        world.restoreComponentState(
          cell.destinationX - left,
          cell.destinationY - top,
          cell.componentState,
        );
      }
    }
    visitInternalWelds(active, mappedCells, (cell, neighbor) => {
      world.setWeld(
        cell.destinationX - left,
        cell.destinationY - top,
        neighbor.destinationX - left,
        neighbor.destinationY - top,
        true,
      );
    });
    return world;
  }

  deleteFrom(world: World): boolean {
    const active = this.activeSelection;
    if (active === null) {
      return false;
    }
    const changed = active.removesSourceOnCommit && clearSourceCells(world, active.content);
    this.activeSelection = null;
    this.cancelDraft();
    return changed;
  }

  commit(
    world: World,
    canPlaceCell: SelectionCellPredicate,
    canPlaceKind: SelectionKindPredicate,
  ): TileSelectionCommitResult {
    const active = this.activeSelection;
    this.activeSelection = null;
    this.cancelDraft();
    if (active === null) {
      return { accepted: true, changed: false };
    }
    const mappedCells = mapOccupiedCells(active);
    if (!mappedCells.every((cell) =>
      canPlaceCell(cell.destinationX, cell.destinationY) && canPlaceKind(cell.kind)
    )) {
      return { accepted: false, changed: false };
    }
    if (placementIsUnchanged(active)) {
      return { accepted: true, changed: false };
    }

    const next = world.clone();
    if (active.removesSourceOnCommit) {
      clearSourceCells(next, active.content);
    }
    for (const cell of mappedCells) {
      if (next.kindAt(cell.destinationX, cell.destinationY) !== TileKind.Empty) {
        next.place(cell.destinationX, cell.destinationY, TileKind.Empty);
      }
    }
    for (const cell of mappedCells) {
      next.place(cell.destinationX, cell.destinationY, cell.kind, cell.orientation, cell.mirrored);
      if (cell.componentState !== null) {
        next.restoreComponentState(cell.destinationX, cell.destinationY, cell.componentState);
      }
    }
    restoreInternalWelds(next, active, mappedCells);
    world.copyFrom(next);
    return { accepted: true, changed: mappedCells.length > 0 };
  }

  clear(): void {
    this.activeSelection = null;
    this.cancelDraft();
  }

  overlay(
    canPlaceCell: SelectionCellPredicate,
    canPlaceKind: SelectionKindPredicate,
  ): TileSelectionOverlay | null {
    const active = this.activeSelection;
    if (active === null) {
      return null;
    }
    const mappedCells = mapOccupiedCells(active);
    return {
      region: transformedRegion(active),
      sourceRegion: active.removesSourceOnCommit ? active.content.region : null,
      previewCells: createPreviewCells(active, mappedCells),
      valid: mappedCells.every((cell) =>
        canPlaceCell(cell.destinationX, cell.destinationY) && canPlaceKind(cell.kind)
      ),
    };
  }

  /** Applies a rotation only when the rotated bounds still fit inside the board. */
  private setQuarterTurns(active: ActiveSelection, quarterTurns: Direction): boolean {
    const { width, height } = active.content.bounds;
    const rotatedWidth = (quarterTurns & 1) === 0 ? width : height;
    const rotatedHeight = (quarterTurns & 1) === 0 ? height : width;
    if (rotatedWidth > this.boardWidth || rotatedHeight > this.boardHeight) {
      return false;
    }
    active.quarterTurns = quarterTurns;
    this.setOrigin(active, active.originX, active.originY);
    return true;
  }

  private setOrigin(active: ActiveSelection, x: number, y: number): boolean {
    const dimensions = transformedDimensions(active);
    const nextX = Math.max(0, Math.min(this.boardWidth - dimensions.width, x));
    const nextY = Math.max(0, Math.min(this.boardHeight - dimensions.height, y));
    if (nextX === active.originX && nextY === active.originY) {
      return false;
    }
    active.originX = nextX;
    active.originY = nextY;
    return true;
  }

  private requireCell(x: number, y: number): void {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      x >= this.boardWidth ||
      y < 0 ||
      y >= this.boardHeight
    ) {
      throw new RangeError(`Selection cell (${x}, ${y}) is outside the board`);
    }
  }
}

function captureSelectionContent(world: World, region: GridRegion): SelectionContent | null {
  const bounds = regionBounds(region);
  if (bounds === null) {
    return null;
  }
  const sourceWorld = world.clone();
  const occupiedCells: OccupiedSelectionCell[] = [];
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (!region.contains(x, y)) {
        continue;
      }
      const kind = sourceWorld.kindAt(x, y);
      if (kind === TileKind.Empty) {
        continue;
      }
      occupiedCells.push({
        x,
        y,
        kind,
        orientation: sourceWorld.orientationAt(x, y),
        mirrored: sourceWorld.mirroredAt(x, y),
        componentState: sourceWorld.componentStateSnapshotAt(x, y),
      });
    }
  }
  return { sourceWorld, region, bounds, occupiedCells };
}

function mapOccupiedCells(active: ActiveSelection): MappedSelectionCell[] {
  return active.content.occupiedCells.map((cell) => {
    const destination = transformCell(active, cell.x, cell.y);
    let orientation = cell.orientation;
    if (active.flippedHorizontally) {
      orientation = flipDirectionHorizontally(orientation);
    }
    if (active.flippedVertically) {
      orientation = flipDirectionVertically(orientation);
    }
    orientation = orientationForKind(
      cell.kind,
      ((orientation + active.quarterTurns) & 3) as Direction,
    );
    return {
      ...cell,
      sourceX: cell.x,
      sourceY: cell.y,
      destinationX: destination.x,
      destinationY: destination.y,
      orientation,
      mirrored: mirroringForKind(
        cell.kind,
        cell.mirrored !== (active.flippedHorizontally !== active.flippedVertically),
      ),
      componentState: cell.componentState === null
        ? null
        : transformComponentSnapshot(
          cell.componentState,
          active.quarterTurns,
          active.flippedHorizontally,
          active.flippedVertically,
        ),
    };
  });
}

function createPreviewCells(
  active: ActiveSelection,
  mappedCells: readonly MappedSelectionCell[],
): SelectionPreviewCell[] {
  const previewBySource = new Map<string, {
    x: number;
    y: number;
    kind: TileKind;
    orientation: Direction;
    weldRight: boolean;
    weldDown: boolean;
  }>();
  const previewCells = mappedCells.map((cell) => {
    const preview = {
      x: cell.destinationX,
      y: cell.destinationY,
      kind: cell.kind,
      orientation: cell.orientation,
      mirrored: cell.mirrored,
      componentState: cell.componentState,
      weldRight: false,
      weldDown: false,
    };
    previewBySource.set(cellKey(cell.sourceX, cell.sourceY), preview);
    return preview;
  });
  visitInternalWelds(active, mappedCells, (first, second) => {
    const firstPreview = previewBySource.get(cellKey(first.sourceX, first.sourceY));
    const secondPreview = previewBySource.get(cellKey(second.sourceX, second.sourceY));
    if (firstPreview === undefined || secondPreview === undefined) {
      throw new Error("Selection preview weld is missing a mapped cell");
    }
    if (firstPreview.y === secondPreview.y && Math.abs(firstPreview.x - secondPreview.x) === 1) {
      const left = firstPreview.x < secondPreview.x ? firstPreview : secondPreview;
      left.weldRight = true;
    } else if (
      firstPreview.x === secondPreview.x &&
      Math.abs(firstPreview.y - secondPreview.y) === 1
    ) {
      const top = firstPreview.y < secondPreview.y ? firstPreview : secondPreview;
      top.weldDown = true;
    } else {
      throw new Error("Selection transform produced a non-adjacent weld");
    }
  });
  return previewCells;
}

function transformedRegion(active: ActiveSelection): GridRegion {
  return new GridRegion(active.content.region.rectangles.map((rectangle) =>
    transformRectangle(active, rectangle)
  ));
}

function transformedDimensions(active: ActiveSelection): { readonly width: number; readonly height: number } {
  const { width, height } = active.content.bounds;
  return (active.quarterTurns & 1) === 0
    ? { width, height }
    : { width: height, height: width };
}

function transformCell(active: ActiveSelection, x: number, y: number): GridCell {
  const bounds = active.content.bounds;
  let localX = x - bounds.x;
  let localY = y - bounds.y;
  if (active.flippedHorizontally) {
    localX = bounds.width - 1 - localX;
  }
  if (active.flippedVertically) {
    localY = bounds.height - 1 - localY;
  }
  switch (active.quarterTurns) {
    case 0:
      return { x: active.originX + localX, y: active.originY + localY };
    case 1:
      return {
        x: active.originX + bounds.height - 1 - localY,
        y: active.originY + localX,
      };
    case 2:
      return {
        x: active.originX + bounds.width - 1 - localX,
        y: active.originY + bounds.height - 1 - localY,
      };
    case 3:
      return {
        x: active.originX + localY,
        y: active.originY + bounds.width - 1 - localX,
      };
    default:
      throw new RangeError(`Invalid selection rotation ${active.quarterTurns}`);
  }
}

function transformRectangle(active: ActiveSelection, rectangle: GridRectangle): GridRectangle {
  const first = transformCell(active, rectangle.x, rectangle.y);
  const last = transformCell(
    active,
    rectangle.x + rectangle.width - 1,
    rectangle.y + rectangle.height - 1,
  );
  const oppositeFirst = transformCell(
    active,
    rectangle.x + rectangle.width - 1,
    rectangle.y,
  );
  const oppositeLast = transformCell(
    active,
    rectangle.x,
    rectangle.y + rectangle.height - 1,
  );
  const x = Math.min(first.x, last.x, oppositeFirst.x, oppositeLast.x);
  const y = Math.min(first.y, last.y, oppositeFirst.y, oppositeLast.y);
  return {
    x,
    y,
    width: Math.max(first.x, last.x, oppositeFirst.x, oppositeLast.x) - x + 1,
    height: Math.max(first.y, last.y, oppositeFirst.y, oppositeLast.y) - y + 1,
  };
}

function placementIsUnchanged(active: ActiveSelection): boolean {
  return active.removesSourceOnCommit &&
    active.quarterTurns === 0 &&
    !active.flippedHorizontally &&
    !active.flippedVertically &&
    active.originX === active.content.bounds.x &&
    active.originY === active.content.bounds.y;
}

function clearSourceCells(world: World, content: SelectionContent): boolean {
  let changed = false;
  for (const cell of content.occupiedCells) {
    if (world.kindAt(cell.x, cell.y) !== TileKind.Empty) {
      world.place(cell.x, cell.y, TileKind.Empty);
      changed = true;
    }
  }
  return changed;
}

function restoreInternalWelds(
  world: World,
  active: ActiveSelection,
  mappedCells: readonly MappedSelectionCell[],
): void {
  visitInternalWelds(active, mappedCells, (cell, neighbor) => {
    world.setWeld(
      cell.destinationX,
      cell.destinationY,
      neighbor.destinationX,
      neighbor.destinationY,
      true,
    );
  });
}

function visitInternalWelds(
  active: ActiveSelection,
  mappedCells: readonly MappedSelectionCell[],
  visit: (first: MappedSelectionCell, second: MappedSelectionCell) => void,
): void {
  const mappedBySource = new Map<string, MappedSelectionCell>();
  for (const cell of mappedCells) {
    mappedBySource.set(cellKey(cell.sourceX, cell.sourceY), cell);
  }
  for (const cell of mappedCells) {
    for (const neighbor of [
      mappedBySource.get(cellKey(cell.sourceX + 1, cell.sourceY)),
      mappedBySource.get(cellKey(cell.sourceX, cell.sourceY + 1)),
    ]) {
      if (
        neighbor !== undefined &&
        active.content.sourceWorld.isWelded(
          cell.sourceX,
          cell.sourceY,
          neighbor.sourceX,
          neighbor.sourceY,
        )
      ) {
        visit(cell, neighbor);
      }
    }
  }
}

function intersectRegion(rectangle: GridRectangle, region: GridRegion | null): GridRegion {
  if (region === null) {
    return new GridRegion([rectangle]);
  }
  const intersections: GridRectangle[] = [];
  for (const allowed of region.rectangles) {
    const x = Math.max(rectangle.x, allowed.x);
    const y = Math.max(rectangle.y, allowed.y);
    const right = Math.min(rectangle.x + rectangle.width, allowed.x + allowed.width);
    const bottom = Math.min(rectangle.y + rectangle.height, allowed.y + allowed.height);
    if (x < right && y < bottom) {
      intersections.push({ x, y, width: right - x, height: bottom - y });
    }
  }
  return new GridRegion(intersections);
}

function regionBounds(region: GridRegion): GridRectangle | null {
  if (region.rectangles.length === 0) {
    return null;
  }
  let x = Number.POSITIVE_INFINITY;
  let y = Number.POSITIVE_INFINITY;
  let right = 0;
  let bottom = 0;
  for (const rectangle of region.rectangles) {
    x = Math.min(x, rectangle.x);
    y = Math.min(y, rectangle.y);
    right = Math.max(right, rectangle.x + rectangle.width);
    bottom = Math.max(bottom, rectangle.y + rectangle.height);
  }
  return { x, y, width: right - x, height: bottom - y };
}

function rectangleBetween(first: GridCell, second: GridCell): GridRectangle {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  return {
    x,
    y,
    width: Math.max(first.x, second.x) - x + 1,
    height: Math.max(first.y, second.y) - y + 1,
  };
}


function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}
