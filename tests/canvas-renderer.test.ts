import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasRenderer } from "../src/render/canvas-renderer";
import { World } from "../src/simulation/world";

interface FakeCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
}

function createCanvas(width: number, height: number): FakeCanvas {
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
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
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

  it("centers at the largest size inside the unobscured viewport", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { canvas } = createCanvas(800, 600);
    const renderer = new CanvasRenderer(canvas, new World(20, 10));
    renderer.setViewportInsets({ top: 0, right: 200, bottom: 0, left: 0 });

    renderer.fitBoardToViewport();

    expect(renderer.gridPointFromClientPoint(0, 150)).toEqual({ x: 0, y: 0 });
    expect(renderer.gridPointFromClientPoint(600, 450)).toEqual({ x: 20, y: 10 });
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
