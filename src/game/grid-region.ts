export interface GridRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GridBoundaryEdge {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** A fixed union of axis-aligned rectangular grid-cell regions. */
export class GridRegion {
  readonly rectangles: readonly GridRectangle[];
  readonly boundaryEdges: readonly GridBoundaryEdge[];

  constructor(rectangles: readonly GridRectangle[]) {
    this.rectangles = Object.freeze(rectangles.map((rectangle) => {
      if (
        !Number.isInteger(rectangle.x) ||
        !Number.isInteger(rectangle.y) ||
        !Number.isInteger(rectangle.width) ||
        !Number.isInteger(rectangle.height) ||
        rectangle.x < 0 ||
        rectangle.y < 0 ||
        rectangle.width <= 0 ||
        rectangle.height <= 0
      ) {
        throw new Error("Grid rectangles require non-negative integer positions and positive integer sizes");
      }
      return Object.freeze({ ...rectangle });
    }));
    this.boundaryEdges = Object.freeze(this.buildBoundaryEdges());
  }

  contains(x: number, y: number): boolean {
    for (const rectangle of this.rectangles) {
      if (
        x >= rectangle.x &&
        x < rectangle.x + rectangle.width &&
        y >= rectangle.y &&
        y < rectangle.y + rectangle.height
      ) {
        return true;
      }
    }
    return false;
  }

  containsEdge(x1: number, y1: number, x2: number, y2: number): boolean {
    return this.contains(x1, y1) || this.contains(x2, y2);
  }

  fitsWithin(width: number, height: number): boolean {
    return this.rectangles.every((rectangle) =>
      rectangle.x + rectangle.width <= width &&
      rectangle.y + rectangle.height <= height
    );
  }

  private buildBoundaryEdges(): GridBoundaryEdge[] {
    if (this.rectangles.length === 0) {
      return [];
    }

    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = 0;
    let bottom = 0;
    for (const rectangle of this.rectangles) {
      left = Math.min(left, rectangle.x);
      top = Math.min(top, rectangle.y);
      right = Math.max(right, rectangle.x + rectangle.width);
      bottom = Math.max(bottom, rectangle.y + rectangle.height);
    }

    const edges: GridBoundaryEdge[] = [];
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        if (!this.contains(x, y)) {
          continue;
        }
        if (!this.contains(x - 1, y)) {
          edges.push({ x1: x, y1: y, x2: x, y2: y + 1 });
        }
        if (!this.contains(x + 1, y)) {
          edges.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 });
        }
        if (!this.contains(x, y - 1)) {
          edges.push({ x1: x, y1: y, x2: x + 1, y2: y });
        }
        if (!this.contains(x, y + 1)) {
          edges.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 });
        }
      }
    }
    return edges;
  }
}
