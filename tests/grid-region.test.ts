import { describe, expect, it } from "vitest";

import { GridRegion } from "../src/game/grid-region";

function edgeKey(x1: number, y1: number, x2: number, y2: number): string {
  return `${x1},${y1}-${x2},${y2}`;
}

describe("grid regions", () => {
  it("contains cells in any rectangle using half-open bounds", () => {
    const region = new GridRegion([
      { x: 2, y: 3, width: 3, height: 2 },
      { x: 7, y: 1, width: 1, height: 4 },
    ]);

    expect(region.contains(2, 3)).toBe(true);
    expect(region.contains(4, 4)).toBe(true);
    expect(region.contains(7, 4)).toBe(true);
    expect(region.contains(5, 4)).toBe(false);
    expect(region.contains(7, 5)).toBe(false);
  });

  it("contains edges inside or on the perimeter of the editable region", () => {
    const region = new GridRegion([{ x: 2, y: 2, width: 2, height: 1 }]);

    expect(region.containsEdge(2, 2, 3, 2)).toBe(true);
    expect(region.containsEdge(1, 2, 2, 2)).toBe(true);
    expect(region.containsEdge(3, 2, 4, 2)).toBe(true);
    expect(region.containsEdge(2, 1, 2, 2)).toBe(true);
    expect(region.containsEdge(2, 2, 2, 3)).toBe(true);
    expect(region.containsEdge(0, 0, 1, 0)).toBe(false);
  });

  it("traces only the outer boundary of overlapping rectangle unions", () => {
    const region = new GridRegion([
      { x: 0, y: 0, width: 2, height: 1 },
      { x: 1, y: 0, width: 1, height: 2 },
    ]);
    const boundary = region.boundaryEdges.map((edge) =>
      edgeKey(edge.x1, edge.y1, edge.x2, edge.y2)
    ).sort();

    expect(boundary).toEqual([
      "0,0-0,1",
      "0,0-1,0",
      "0,1-1,1",
      "1,0-2,0",
      "1,1-1,2",
      "1,2-2,2",
      "2,0-2,1",
      "2,1-2,2",
    ]);
  });

  it("reports whether every rectangle fits inside a board", () => {
    const region = new GridRegion([
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 5, y: 1, width: 2, height: 2 },
    ]);

    expect(region.fitsWithin(7, 6)).toBe(true);
    expect(region.fitsWithin(6, 6)).toBe(false);
    expect(region.fitsWithin(7, 5)).toBe(false);
  });

  it("rejects invalid rectangles", () => {
    expect(() => new GridRegion([{ x: -1, y: 0, width: 1, height: 1 }])).toThrow(
      "non-negative integer positions",
    );
    expect(() => new GridRegion([{ x: 0, y: 0, width: 0, height: 1 }])).toThrow(
      "positive integer sizes",
    );
    expect(() => new GridRegion([{ x: 0.5, y: 0, width: 1, height: 1 }])).toThrow(
      "non-negative integer positions",
    );
  });
});
