import { GridRegion, type GridRectangle } from "./grid-region";

/** Mutable sandbox-only authoring state for a puzzle's editable-region rectangles. */
export class EditableRegionAuthoringState {
  private width: number;
  private height: number;
  private committedRegion = new GridRegion([]);
  private dragStartX = -1;
  private dragStartY = -1;
  private dragEndX = -1;
  private dragEndY = -1;

  constructor(width: number, height: number) {
    this.requireDimensions(width, height);
    this.width = width;
    this.height = height;
  }

  get region(): GridRegion {
    return this.committedRegion;
  }

  get draftRectangle(): GridRectangle | null {
    if (this.dragStartX < 0) {
      return null;
    }
    return rectangleBetween(
      this.dragStartX,
      this.dragStartY,
      this.dragEndX,
      this.dragEndY,
    );
  }

  beginRectangle(x: number, y: number): void {
    this.requireCell(x, y);
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragEndX = x;
    this.dragEndY = y;
  }

  updateRectangle(x: number, y: number): boolean {
    if (this.dragStartX < 0) {
      return false;
    }
    this.requireCell(x, y);
    if (x === this.dragEndX && y === this.dragEndY) {
      return false;
    }
    this.dragEndX = x;
    this.dragEndY = y;
    return true;
  }

  commitRectangle(): boolean {
    const rectangle = this.draftRectangle;
    if (rectangle === null) {
      return false;
    }
    this.committedRegion = new GridRegion([...this.committedRegion.rectangles, rectangle]);
    this.cancelRectangle();
    return true;
  }

  cancelRectangle(): void {
    this.dragStartX = -1;
    this.dragStartY = -1;
    this.dragEndX = -1;
    this.dragEndY = -1;
  }

  removeRectanglesAt(x: number, y: number): boolean {
    this.requireCell(x, y);
    const remaining = this.committedRegion.rectangles.filter((rectangle) =>
      x < rectangle.x ||
      x >= rectangle.x + rectangle.width ||
      y < rectangle.y ||
      y >= rectangle.y + rectangle.height
    );
    if (remaining.length === this.committedRegion.rectangles.length) {
      return false;
    }
    this.committedRegion = new GridRegion(remaining);
    return true;
  }

  resetForBoard(width: number, height: number): void {
    this.requireDimensions(width, height);
    this.width = width;
    this.height = height;
    this.committedRegion = new GridRegion([]);
    this.cancelRectangle();
  }

  private requireCell(x: number, y: number): void {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      x >= this.width ||
      y < 0 ||
      y >= this.height
    ) {
      throw new RangeError(`Editable-region cell (${x}, ${y}) is outside the board`);
    }
  }

  private requireDimensions(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("Editable-region board dimensions must be positive integers");
    }
  }
}

function rectangleBetween(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): GridRectangle {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  return {
    x,
    y,
    width: Math.max(startX, endX) - x + 1,
    height: Math.max(startY, endY) - y + 1,
  };
}
