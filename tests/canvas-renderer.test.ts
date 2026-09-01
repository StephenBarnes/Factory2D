import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasRenderer } from "../src/render/canvas-renderer";
import { World } from "../src/simulation/world";

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
