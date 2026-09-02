import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import { CanvasRenderer } from "../src/render/canvas-renderer";
import { World } from "../src/simulation/world";
import { TileKind } from "../src/simulation/tile";

interface FakeCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
}

function createCanvas(width: number, height: number, left = 0, top = 0): FakeCanvas {
  const context = {
    imageSmoothingEnabled: true,
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    getContext: (kind: string) => kind === "2d" ? context : null,
    getBoundingClientRect: () => ({ left, top }),
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

interface PathRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

class RecordingPath2D {
  readonly rectangles: PathRectangle[] = [];

  moveTo(_x: number, _y: number): void {}
  arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _radius: number): void {}
  closePath(): void {}

  rect(x: number, y: number, width: number, height: number): void {
    this.rectangles.push({ x, y, width, height });
  }
}
interface RecordingCanvas extends FakeCanvas {
  readonly filledPaths: RecordingPath2D[];
  readonly clip: Mock;
}

function createRecordingCanvas(width: number, height: number): RecordingCanvas {
  const filledPaths: RecordingPath2D[] = [];
  const clip = vi.fn();
  const context = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    lineDashOffset: 0,
    imageSmoothingEnabled: true,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setLineDash: vi.fn(),
    clip,
    fill: (path?: RecordingPath2D) => {
      if (path !== undefined) {
        filledPaths.push(path);
      }
    },
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    getContext: (kind: string) => kind === "2d" ? context : null,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
  return { canvas, context, filledPaths, clip };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CanvasRenderer viewport fitting", () => {
  it("uses subpixel cells when needed to fit the complete maximum-size board", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { canvas } = createCanvas(300, 200);
    const renderer = new CanvasRenderer(canvas, new World(400, 300));

    renderer.fitBoardToViewport();

    const topLeft = renderer.gridPointFromClientPoint(50 / 3, 0);
    const bottomRight = renderer.gridPointFromClientPoint(850 / 3, 200);
    expect(topLeft.x).toBeCloseTo(0);
    expect(topLeft.y).toBeCloseTo(0);
    expect(bottomRight.x).toBeCloseTo(400);
    expect(bottomRight.y).toBeCloseTo(300);
  });

  it("centers in the canvas regardless of its screen position", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { canvas } = createCanvas(800, 600, 240, 30);
    const renderer = new CanvasRenderer(canvas, new World(20, 10));

    renderer.fitBoardToViewport();

    expect(renderer.gridPointFromClientPoint(240, 130)).toEqual({ x: 0, y: 0 });
    expect(renderer.gridPointFromClientPoint(1_040, 530)).toEqual({ x: 20, y: 10 });
  });

  it("restores the fitted view after player panning", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { canvas } = createCanvas(640, 480);
    const renderer = new CanvasRenderer(canvas, new World(20, 10));
    renderer.fitBoardToViewport();
    renderer.panByPixels(100, 50);

    renderer.fitBoardToViewport();

    expect(renderer.gridPointFromClientPoint(0, 80)).toEqual({ x: 0, y: 0 });
    expect(renderer.gridPointFromClientPoint(640, 400)).toEqual({ x: 20, y: 10 });
  });
});

describe("CanvasRenderer scalable tile rendering", () => {
  it("batches same-kind cells without procedural body drawing below six screen pixels", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("Path2D", RecordingPath2D);
    const world = new World(400, 300);
    world.place(0, 0, TileKind.Platform);
    world.place(1, 0, TileKind.Platform);
    const { canvas, filledPaths, clip } = createRecordingCanvas(800, 600);
    const renderer = new CanvasRenderer(canvas, world);

    renderer.render();

    expect(clip).not.toHaveBeenCalled();
    expect(filledPaths).toHaveLength(1);
    expect(filledPaths[0]?.rectangles).toHaveLength(2);
  });

  it("does not submit detailed bodies outside the expanded visible grid rectangle", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("Path2D", RecordingPath2D);
    const world = new World(20, 1);
    world.place(0, 0, TileKind.Platform);
    world.place(19, 0, TileKind.Platform);
    const { canvas, clip } = createRecordingCanvas(200, 100);
    const renderer = new CanvasRenderer(canvas, world);
    renderer.fitBoardToViewport();
    renderer.zoomAtClientPoint(0, 50, -5_000);

    renderer.render();

    expect(clip).toHaveBeenCalledTimes(1);
  });
});
