import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import { TileSelectionState } from "../src/game/tile-selection";
import { CanvasRenderer } from "../src/render/canvas-renderer";
import { CIRCUIT_CHARGE_COLORS } from "../src/simulation/circuit";
import { Simulation } from "../src/simulation/simulation";
import { World } from "../src/simulation/world";
import { TILE_DEFINITIONS, TileKind } from "../src/simulation/tile";

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

let pathConstructionCount = 0;

class RecordingPath2D {
  readonly rectangles: PathRectangle[] = [];
  constructor() {
    pathConstructionCount += 1;
  }


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
  readonly fillStyles: string[];
}

function createRecordingCanvas(width: number, height: number): RecordingCanvas {
  const filledPaths: RecordingPath2D[] = [];
  const fillStyles: string[] = [];
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
    rect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    setLineDash: vi.fn(),
    clip,
    fill: (path?: RecordingPath2D) => {
      fillStyles.push(context.fillStyle as string);
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
  return { canvas, context, filledPaths, fillStyles, clip };
}

interface PaintedRectangle extends PathRectangle {
  readonly fill: string;
}

function createMotionCanvas(width: number, height: number): RecordingCanvas & {
  readonly rectangles: PaintedRectangle[];
} {
  const recording = createRecordingCanvas(width, height);
  const rectangles: PaintedRectangle[] = [];
  let translateX = 0;
  let translateY = 0;
  const stack: Array<readonly [number, number]> = [];
  vi.mocked(recording.context.save).mockImplementation(() => {
    stack.push([translateX, translateY]);
  });
  vi.mocked(recording.context.restore).mockImplementation(() => {
    const saved = stack.pop();
    if (saved === undefined) throw new Error("Unbalanced canvas restore");
    [translateX, translateY] = saved;
  });
  vi.mocked(recording.context.translate).mockImplementation((x, y) => {
    translateX += x;
    translateY += y;
  });
  vi.mocked(recording.context.fillRect).mockImplementation((x, y, rectWidth, rectHeight) => {
    rectangles.push({
      x: x + translateX, y: y + translateY, width: rectWidth, height: rectHeight,
      fill: recording.context.fillStyle as string,
    });
  });
  return { ...recording, rectangles };
}

afterEach(() => {
  vi.unstubAllGlobals();
  pathConstructionCount = 0;
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

  it("preserves a player-modified camera across renderer replacement", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { canvas } = createCanvas(640, 480);
    const original = new CanvasRenderer(canvas, new World(20, 10));
    original.fitBoardToViewport();
    original.zoomAtClientPoint(200, 150, -300);
    original.panByPixels(75, -40);
    const expectedPoint = original.gridPointFromClientPoint(123, 234);

    const replacement = new CanvasRenderer(canvas, new World(20, 10));
    replacement.restoreView(original.captureView());

    const actualPoint = replacement.gridPointFromClientPoint(123, 234);
    expect(actualPoint.x).toBeCloseTo(expectedPoint.x);
    expect(actualPoint.y).toBeCloseTo(expectedPoint.y);
  });
});

describe("CanvasRenderer scalable tile rendering", () => {
  it("draws configured ROM values in a moved selection rather than an empty default grid", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("Path2D", RecordingPath2D);
    const world = new World(4, 2);
    world.place(0, 0, TileKind.Rom);
    world.configureTernaryGrid(0, 0, 2, 1, [1, -1]);
    const selection = new TileSelectionState(world.width, world.height);
    selection.beginSelection(0, 0);
    selection.updateSelection(0, 0);
    selection.finishSelection(world, null);
    selection.beginMove(0, 0);
    selection.updateMove(2, 0);
    selection.finishMove();
    const { canvas, context } = createRecordingCanvas(400, 200);
    world.place(0, 0, TileKind.Empty);
    const rectangleColors: string[] = [];
    vi.mocked(context.fillRect).mockImplementation(() => {
      rectangleColors.push(context.fillStyle as string);
    });
    const renderer = new CanvasRenderer(canvas, world);
    renderer.setTileSelection(selection.overlay(() => true, () => true), null);

    renderer.render();

    expect(rectangleColors).toContain(CIRCUIT_CHARGE_COLORS[1]);
    expect(rectangleColors).toContain(CIRCUIT_CHARGE_COLORS[-1]);
  });

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

  it("updates low-detail painted cells after kind edits and fractional camera changes", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1.25 });
    vi.stubGlobal("Path2D", RecordingPath2D);
    const world = new World(400, 300);
    world.place(100, 100, TileKind.Platform);
    const { canvas, filledPaths, fillStyles } = createRecordingCanvas(400, 300);
    const renderer = new CanvasRenderer(canvas, world);
    renderer.restoreView({ cellSize: 4, centerX: 100, centerY: 100 });
    const painted = (progress: number) => {
      filledPaths.length = 0;
      renderer.render(null, progress);
      return filledPaths.flatMap(path => path.rectangles);
    };
    expect(painted(0)).toEqual([{ x: 200, y: 150, width: 4, height: 4 }]);
    expect(painted(0.25)).toEqual([{ x: 200, y: 150, width: 4, height: 4 }]);

    world.place(100, 100, TileKind.Gold);
    expect(painted(0.5)).toEqual([{ x: 200, y: 150, width: 4, height: 4 }]);
    expect(fillStyles.at(-1)).toBe(TILE_DEFINITIONS[TileKind.Gold].fill);
    renderer.panByPixels(0.17, 0.37);
    const panned = painted(0.75);
    expect(panned).toHaveLength(1);
    expect(panned[0]?.x).toBeCloseTo(200.17);
    expect(panned[0]?.y).toBeCloseTo(150.37);
    renderer.restoreView({ cellSize: 2, centerX: 100, centerY: 100 });
    expect(painted(1)).toEqual([{ x: 200, y: 150, width: 2, height: 2 }]);
  });

  it("does not reuse committed low-detail positions during or after a moving frame", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("Path2D", RecordingPath2D);
    const world = new World(400, 300);
    world.place(100, 100, TileKind.Stone);
    const previous = world.clone();
    new Simulation(world).step(previous);
    const { canvas, filledPaths } = createRecordingCanvas(400, 300);
    const renderer = new CanvasRenderer(canvas, world);
    renderer.restoreView({ cellSize: 4, centerX: 100, centerY: 100 });
    renderer.render();
    // Start from a cached committed frame, then seek through interpolation in both directions.
    for (const progress of [0, 0.5, 1, 0.25, 1]) {
      filledPaths.length = 0;
      renderer.render(previous, progress);
      expect(filledPaths.flatMap(path => path.rectangles)).toEqual([
        { x: 200, y: 150 + 4 * progress, width: 4, height: 4 },
      ]);
    }
    filledPaths.length = 0;
    renderer.render();
    expect(filledPaths.flatMap(path => path.rectangles)).toEqual([
      { x: 200, y: 154, width: 4, height: 4 },
    ]);
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

  it("refreshes visual state without rebuilding unchanged body geometry", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("Path2D", RecordingPath2D);
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Conduit);
    const { canvas, fillStyles } = createRecordingCanvas(100, 100);
    const renderer = new CanvasRenderer(canvas, world);

    renderer.render();
    const initialPathCount = pathConstructionCount;
    fillStyles.length = 0;

    world.setCharge(0, 0, 1);
    renderer.render();

    expect(pathConstructionCount).toBe(initialPathCount);
    expect(fillStyles).toContain(CIRCUIT_CHARGE_COLORS[1]);

    world.place(0, 0, TileKind.Platform);
    renderer.render();
    expect(pathConstructionCount).toBeGreaterThan(initialPathCount);
  });

  it("rebuilds only bodies neighboring a changed geometry cell", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("Path2D", RecordingPath2D);
    const world = new World(6, 1);
    world.place(0, 0, TileKind.Platform);
    world.place(2, 0, TileKind.Platform);
    world.place(5, 0, TileKind.Platform);
    const { canvas } = createRecordingCanvas(600, 100);
    const renderer = new CanvasRenderer(canvas, world);

    renderer.render();
    const initialPathCount = pathConstructionCount;

    world.place(2, 0, TileKind.Stone);
    renderer.render();

    expect(pathConstructionCount).toBe(initialPathCount + 1);
  });

  it("skips canvas drawing for an unchanged static frame", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("Path2D", RecordingPath2D);
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Platform);
    const { canvas, context } = createRecordingCanvas(100, 100);
    const renderer = new CanvasRenderer(canvas, world);

    renderer.render();
    renderer.render();
    expect(context.clearRect).toHaveBeenCalledTimes(1);

    world.place(0, 0, TileKind.Stone);
    renderer.render();
    expect(context.clearRect).toHaveBeenCalledTimes(2);
  });

  it("redraws unchanged charged conveyors for their time-based animation", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("Path2D", RecordingPath2D);
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Conveyor);
    world.setCharge(0, 0, 1);
    const { canvas, context } = createRecordingCanvas(100, 100);
    const renderer = new CanvasRenderer(canvas, world);

    renderer.render(null, 1, 0);
    renderer.render(null, 1, 16);

    expect(context.clearRect).toHaveBeenCalledTimes(2);
  });
});

describe("CanvasRenderer coupled piston interpolation", () => {
  it("moves each head, carried housing, welded charge, and welded load by its own stroke sum", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("Path2D", RecordingPath2D);
    const world = new World(6, 8);
    for (let y = 5; y <= 7; y += 1) {
      world.place(2, y, TileKind.Piston);
      world.place(3, y, TileKind.FixedCharge);
      world.setWeld(2, y, 3, y, true);
      if (y > 5) world.setWeld(2, y, 2, y - 1, true);
    }
    world.place(2, 4, TileKind.Stone);
    world.setWeld(2, 5, 2, 4, true);
    const previous = world.clone();
    const { canvas, rectangles } = createMotionCanvas(240, 320);
    const renderer = new CanvasRenderer(canvas, world);
    const cellSize = 40;
    const positions = () => ({
      heads: rectangles.filter(rect => rect.fill === "#d1aa6b" && rect.width === cellSize * 0.5)
        .map(rect => rect.y).sort((a, b) => a - b),
      bases: rectangles.filter(rect => rect.fill === TILE_DEFINITIONS[TileKind.PistonBase].fill &&
        rect.width === cellSize).map(rect => rect.y).sort((a, b) => a - b),
      charges: rectangles.filter(rect => rect.fill === TILE_DEFINITIONS[TileKind.FixedCharge].fill &&
        rect.width === cellSize).map(rect => rect.y).sort((a, b) => a - b),
      loads: rectangles.filter(rect => rect.fill === TILE_DEFINITIONS[TileKind.Stone].fill &&
        rect.width === cellSize).map(rect => rect.y),
    });
    renderer.render();
    const initial = positions();
    new Simulation(world).step();
    let animatedPathCount = 0;
    for (const progress of [0, 0.5, 1]) {
      rectangles.length = 0;
      renderer.render(previous, progress);
      const painted = positions();
      const displacements = { heads: [3, 2, 1], bases: [2, 1, 0], charges: [2, 1, 0], loads: [3] };
      for (const key of ["heads", "bases", "charges", "loads"] as const) {
        expect(painted[key]).toHaveLength(displacements[key].length);
        for (let index = 0; index < displacements[key].length; index += 1) {
          expect(painted[key][index]).toBeCloseTo(
            initial[key][index]! - displacements[key][index]! * progress * cellSize,
          );
        }
      }
      if (progress === 0) animatedPathCount = pathConstructionCount;
      else expect(pathConstructionCount).toBe(animatedPathCount);
    }
  });

  it.each([4, 20])("draws long translations crossing the viewport at %i-pixel detail", cellSize => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal("Path2D", RecordingPath2D);
    const world = new World(200, 1);
    world.place(50, 0, TileKind.Stone);
    const previous = world.clone();
    const horizontal = new Int16Array(world.cellCount);
    horizontal[0] = 100;
    world.moveBodies(new Int32Array(world.cellCount), horizontal, new Int16Array(world.cellCount));
    const { canvas, rectangles, filledPaths } = createMotionCanvas(100, 40);
    const renderer = new CanvasRenderer(canvas, world);
    renderer.fitBoardToViewport();
    renderer.zoomAtClientPoint(25, 20, -Math.log(cellSize / 0.5) / 0.0015);

    renderer.render(previous, 0.01);

    const cells = cellSize < 6
      ? filledPaths.flatMap(path => path.rectangles)
      : rectangles.filter(rect => rect.fill === TILE_DEFINITIONS[TileKind.Stone].fill &&
        Math.abs(rect.width - cellSize) < 1e-8);
    expect(cells).toHaveLength(1);
    expect(cells[0]?.x).toBeCloseTo(25 + cellSize);
    expect(cells[0]?.width).toBeCloseTo(cellSize);
  });
});
