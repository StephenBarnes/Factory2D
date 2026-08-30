import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBodyPath,
  drawBody,
  setCircuitPortCharge,
  type BodyCell,
} from "../src/render/tile-renderer";
import { CIRCUIT_CHARGE_COLORS } from "../src/simulation/circuit";
import { Direction, TileKind, WeldSide } from "../src/simulation/tile";

interface ArcCommand {
  readonly type: "arcTo";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly radius: number;
}

type PathCommand =
  | ArcCommand
  | { readonly type: "moveTo"; readonly x: number; readonly y: number }
  | { readonly type: "closePath" };

class RecordingPath2D {
  readonly commands: PathCommand[] = [];

  moveTo(x: number, y: number): void {
    this.commands.push({ type: "moveTo", x, y });
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this.commands.push({ type: "arcTo", x1, y1, x2, y2, radius });
  }

  closePath(): void {
    this.commands.push({ type: "closePath" });
  }
}

interface FillRectCommand {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fillStyle: string | CanvasGradient | CanvasPattern;
}

interface LineSegment {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

interface StrokeCommand {
  readonly strokeStyle: string | CanvasGradient | CanvasPattern;
  readonly segments: readonly LineSegment[];
}

class RecordingCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  readonly fillRects: FillRectCommand[] = [];
  readonly fillStyles: Array<string | CanvasGradient | CanvasPattern> = [];
  readonly strokeStyles: Array<string | CanvasGradient | CanvasPattern> = [];
  readonly strokes: StrokeCommand[] = [];
  private currentX = 0;
  private currentY = 0;
  private currentSegments: LineSegment[] = [];

  save(): void {}
  restore(): void {}
  translate(_x: number, _y: number): void {}
  rotate(_angle: number): void {}
  fill(_path?: Path2D): void {
    this.fillStyles.push(this.fillStyle);
  }
  clip(_path: Path2D): void {}
  beginPath(): void {
    this.currentSegments = [];
  }
  moveTo(x: number, y: number): void {
    this.currentX = x;
    this.currentY = y;
  }
  lineTo(x: number, y: number): void {
    this.currentSegments.push({
      fromX: this.currentX,
      fromY: this.currentY,
      toX: x,
      toY: y,
    });
    this.currentX = x;
    this.currentY = y;
  }
  closePath(): void {}
  stroke(_path?: Path2D): void {
    this.strokeStyles.push(this.strokeStyle);
    this.strokes.push({
      strokeStyle: this.strokeStyle,
      segments: [...this.currentSegments],
    });
  }
  arc(
    _x: number,
    _y: number,
    _radius: number,
    _startAngle: number,
    _endAngle: number,
  ): void {}

  fillRect(x: number, y: number, width: number, height: number): void {
    this.fillRects.push({ x, y, width, height, fillStyle: this.fillStyle });
  }
}

function stone(x: number, y: number, seamRight = false, seamDown = false): BodyCell {
  return {
    x,
    y,
    kind: TileKind.Stone,
    orientation: Direction.Up,
    outputCharge: 0,
    circuitPortCharges: 0,
    circuitConnections: WeldSide.None,
    seamRight,
    seamDown,
  };
}

function pathFor(cells: readonly BodyCell[]): RecordingPath2D {
  return createBodyPath(0, 0, 32, cells, cells.length) as unknown as RecordingPath2D;
}

function cornersNearFirstCut(paths: readonly RecordingPath2D[]): string[] {
  return paths
    .flatMap((path) => path.commands)
    .filter((command): command is ArcCommand =>
      command.type === "arcTo" &&
      command.x1 >= 28 &&
      command.x1 <= 36 &&
      command.y1 <= 36
    )
    .map((command) => JSON.stringify({
      x: command.x1,
      y: command.y1,
      outgoingX: Math.sign(command.x2 - command.x1),
      outgoingY: Math.sign(command.y2 - command.y1),
      radius: command.radius,
    }))
    .sort();
}

beforeEach(() => {
  vi.stubGlobal("Path2D", RecordingPath2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("body drawing", () => {
  it("paints an existing cell identically when another tile kind joins its body", () => {
    const platform: BodyCell = {
      x: 0,
      y: 0,
      kind: TileKind.Platform,
      orientation: Direction.Up,
      outputCharge: 0,
      circuitPortCharges: 0,
      circuitConnections: WeldSide.None,
      seamRight: false,
      seamDown: false,
    };
    const uniformContext = new RecordingCanvasContext();
    const mixedContext = new RecordingCanvasContext();
    const path = new RecordingPath2D() as unknown as Path2D;

    drawBody(
      uniformContext as unknown as CanvasRenderingContext2D,
      0,
      0,
      32,
      [platform],
      1,
      path,
    );
    drawBody(
      mixedContext as unknown as CanvasRenderingContext2D,
      0,
      0,
      32,
      [platform, stone(1, 0)],
      2,
      path,
    );

    expect(uniformContext.fillRects).toHaveLength(1);
    expect(mixedContext.fillRects).toHaveLength(2);
    expect(mixedContext.fillRects[0]).toEqual(uniformContext.fillRects[0]);
  });
});

describe("circuit rendering", () => {
  it("colors sensor wires by network charge and its arrow by sensed output", () => {
    const context = new RecordingCanvasContext();
    const sensor: BodyCell = {
      x: 0,
      y: 0,
      kind: TileKind.Sensor,
      orientation: Direction.Up,
      outputCharge: 1,
      circuitConnections: WeldSide.Right,
      circuitPortCharges: setCircuitPortCharge(0, Direction.Right, -1),
      seamRight: false,
      seamDown: false,
    };

    drawBody(
      context as unknown as CanvasRenderingContext2D,
      0,
      0,
      32,
      [sensor],
      1,
      new RecordingPath2D() as unknown as Path2D,
    );

    expect(context.strokeStyles).toContain(CIRCUIT_CHARGE_COLORS[-1]);
    expect(context.fillStyles).toContain(CIRCUIT_CHARGE_COLORS[1]);
    expect(context.fillStyles).not.toContain(CIRCUIT_CHARGE_COLORS[-1]);
  });

  it.each([
    { kind: TileKind.Inverter, inputDirection: Direction.Down },
    { kind: TileKind.Combiner, inputDirection: Direction.Down },
    { kind: TileKind.Rectifier, inputDirection: Direction.Down },
    { kind: TileKind.Multiplier, inputDirection: Direction.Left },
    { kind: TileKind.Subtractor, inputDirection: Direction.Left },
  ])(
    "keeps $kind input and output traces separate and individually colored",
    ({ kind, inputDirection }) => {
      const context = new RecordingCanvasContext();
      let portCharges = setCircuitPortCharge(0, Direction.Up, 1);
      portCharges = setCircuitPortCharge(portCharges, inputDirection, -1);
      const gate: BodyCell = {
        x: 0,
        y: 0,
        kind,
        orientation: Direction.Up,
        outputCharge: 1,
        circuitConnections: (WeldSide.Up | (1 << inputDirection)) as WeldSide,
        circuitPortCharges: portCharges,
        seamRight: false,
        seamDown: false,
      };

      drawBody(
        context as unknown as CanvasRenderingContext2D,
        0,
        0,
        32,
        [gate],
        1,
        new RecordingPath2D() as unknown as Path2D,
      );

      const outputSegment = context.strokes.find(
        (stroke) => stroke.strokeStyle === CIRCUIT_CHARGE_COLORS[1],
      )?.segments[0];
      expect(outputSegment?.fromX).toBe(16);
      expect(outputSegment?.fromY).toBe(0);
      expect(outputSegment?.toX).toBe(16);
      expect(outputSegment?.toY).toBeCloseTo(7.68);

      const inputSegment = context.strokes.find(
        (stroke) => stroke.strokeStyle === CIRCUIT_CHARGE_COLORS[-1],
      )?.segments[0];
      expect(inputSegment?.fromX).toBe(inputDirection === Direction.Left ? 0 : 16);
      expect(inputSegment?.fromY).toBe(inputDirection === Direction.Down ? 32 : 16);
      expect(inputSegment?.toX).toBeCloseTo(inputDirection === Direction.Left ? 7.68 : 16);
      expect(inputSegment?.toY).toBeCloseTo(inputDirection === Direction.Down ? 24.32 : 16);
    },
  );
});

describe("body outline tracing", () => {
  it("keeps an unwelded edge's local outline when another cut splits a ring", () => {
    const ringWithFirstCut = [
      stone(0, 0, true),
      stone(0, 1),
      stone(0, 2),
      stone(1, 2),
      stone(2, 2),
      stone(2, 1),
      stone(2, 0),
      stone(1, 0),
    ];
    const leftBodyAfterSecondCut = [stone(0, 0), stone(0, 1), stone(0, 2)];
    const rightBodyAfterSecondCut = [
      stone(1, 0),
      stone(2, 0),
      stone(2, 1),
      stone(2, 2),
      stone(1, 2),
    ];

    const before = cornersNearFirstCut([pathFor(ringWithFirstCut)]);
    const after = cornersNearFirstCut([
      pathFor(leftBodyAfterSecondCut),
      pathFor(rightBodyAfterSecondCut),
    ]);

    expect(before).not.toHaveLength(0);
    expect(after).toEqual(before);
  });

  it("rounds closed seam ends instead of creating spikes in a 2x2 body", () => {
    const fixtures = [
      {
        cells: [stone(0, 0, true), stone(0, 1), stone(1, 1), stone(1, 0)],
        capCorners: ["30.4,32", "33.6,32"],
      },
      {
        cells: [stone(0, 0), stone(0, 1, true), stone(1, 0), stone(1, 1)],
        capCorners: ["30.4,32", "33.6,32"],
      },
      {
        cells: [stone(0, 0, false, true), stone(1, 0), stone(1, 1), stone(0, 1)],
        capCorners: ["32,30.4", "32,33.6"],
      },
      {
        cells: [stone(0, 0), stone(0, 1), stone(1, 1), stone(1, 0, false, true)],
        capCorners: ["32,30.4", "32,33.6"],
      },
    ];

    for (const fixture of fixtures) {
      const corners = pathFor(fixture.cells).commands
        .filter((command): command is ArcCommand => command.type === "arcTo")
        .map((command) => `${command.x1},${command.y1}`);
      expect(corners).not.toContain("32,32");
      expect(corners).toEqual(expect.arrayContaining(fixture.capCorners));
    }
  });
});
