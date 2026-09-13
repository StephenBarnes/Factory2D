import { describe, expect, it } from "vitest";

import {
  clampedCellFromGridPoint,
  cellsOnGridSegment,
  visitWeldEdgesOnGridSegment,
} from "../src/render/grid-drag";
import type { GridEdge, GridPoint } from "../src/render/grid-drag";

function crossedEdges(from: GridPoint, to: GridPoint, width = 5, height = 4): GridEdge[] {
  const edges: GridEdge[] = [];
  visitWeldEdgesOnGridSegment(from, to, width, height, (x1, y1, x2, y2) => {
    edges.push({ x1, y1, x2, y2 });
  });
  return edges;
}

describe("grid drag traversal", () => {
  it("keeps a rapid tile drag continuous through the final in-bounds cell", () => {
    expect(cellsOnGridSegment(
      { x: 1.5, y: 2.5 },
      { x: 8, y: 2.5 },
      5,
      4,
    )).toEqual({
      from: { x: 1, y: 2 },
      to: { x: 4, y: 2 },
    });
  });

  it("finds the entry and exit cells when one pointer event crosses the board", () => {
    expect(cellsOnGridSegment(
      { x: -2, y: 1.5 },
      { x: 7, y: 1.5 },
      5,
      4,
    )).toEqual({
      from: { x: 0, y: 1 },
      to: { x: 4, y: 1 },
    });
  });

  it("ignores a tile drag segment that remains outside the board", () => {
    expect(cellsOnGridSegment(
      { x: -2, y: 1 },
      { x: -1, y: 3 },
      5,
      4,
    )).toBeNull();
  });

  it("clamps a rectangle drag endpoint to the board", () => {
    expect(clampedCellFromGridPoint({ x: 8, y: -2 }, 5, 4)).toEqual({ x: 4, y: 0 });
  });

  it("visits every vertical weld crossed by a rapid horizontal drag", () => {
    expect(crossedEdges(
      { x: 0.5, y: 1.5 },
      { x: 4.5, y: 1.5 },
    )).toEqual([
      { x1: 0, y1: 1, x2: 1, y2: 1 },
      { x1: 1, y1: 1, x2: 2, y2: 1 },
      { x1: 2, y1: 1, x2: 3, y2: 1 },
      { x1: 3, y1: 1, x2: 4, y2: 1 },
    ]);
  });

  it("visits crossed welds in reverse pointer order", () => {
    expect(crossedEdges(
      { x: 4.5, y: 2.5 },
      { x: 0.5, y: 2.5 },
    )).toEqual([
      { x1: 3, y1: 2, x2: 4, y2: 2 },
      { x1: 2, y1: 2, x2: 3, y2: 2 },
      { x1: 1, y1: 2, x2: 2, y2: 2 },
      { x1: 0, y1: 2, x2: 1, y2: 2 },
    ]);
  });

  it("visits every weld overlapped while dragging along a grid line", () => {
    expect(crossedEdges(
      { x: 2, y: -1 },
      { x: 2, y: 5 },
    )).toEqual([
      { x1: 1, y1: 0, x2: 2, y2: 0 },
      { x1: 1, y1: 1, x2: 2, y2: 1 },
      { x1: 1, y1: 2, x2: 2, y2: 2 },
      { x1: 1, y1: 3, x2: 2, y2: 3 },
    ]);
  });

  it("welds parallel seams without cross-welding when a fast drag is slightly off the grid line", () => {
    const vertical = crossedEdges({ x: 2.1, y: -1 }, { x: 2.1, y: 5 });
    expect(vertical).toEqual([
      { x1: 1, y1: 0, x2: 2, y2: 0 },
      { x1: 1, y1: 1, x2: 2, y2: 1 },
      { x1: 1, y1: 2, x2: 2, y2: 2 },
      { x1: 1, y1: 3, x2: 2, y2: 3 },
    ]);
    expect(crossedEdges({ x: 2.1, y: 5 }, { x: 2.1, y: -1 })).toEqual([...vertical].reverse());
    expect(crossedEdges({ x: -1, y: 2.1 }, { x: 5, y: 2.1 }, 4, 5)).toEqual(
      vertical.map(({ x1, y1, x2, y2 }) => ({ x1: y1, y1: x1, x2: y2, y2: x2 })),
    );
  });

  it("ignores corner crossings and tile-center motion", () => {
    expect(crossedEdges({ x: 1.9, y: 1.9 }, { x: 2.1, y: 2.1 })).toEqual([]);
    expect(crossedEdges({ x: 1.4, y: 1.4 }, { x: 1.6, y: 1.6 })).toEqual([]);
  });

  it("detects a target grazed without crossing its grid line or ending inside it", () => {
    expect(crossedEdges({ x: 1.85, y: 1.1 }, { x: 1.85, y: 1.9 })).toEqual([
      { x1: 1, y1: 1, x2: 2, y2: 1 },
    ]);
  });

  it("does not emit outer board edges", () => {
    expect(crossedEdges(
      { x: -2, y: 0.5 },
      { x: 7, y: 0.5 },
    )).toEqual([
      { x1: 0, y1: 0, x2: 1, y2: 0 },
      { x1: 1, y1: 0, x2: 2, y2: 0 },
      { x1: 2, y1: 0, x2: 3, y2: 0 },
      { x1: 3, y1: 0, x2: 4, y2: 0 },
    ]);
  });
});
