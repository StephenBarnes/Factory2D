import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBodyPath, drawBody, type BodyCell } from "../src/render/tile-renderer";
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

class RecordingCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  readonly fillRects: FillRectCommand[] = [];

  save(): void {}
  restore(): void {}
  translate(_x: number, _y: number): void {}
  fill(_path?: Path2D): void {}
  clip(_path: Path2D): void {}
  beginPath(): void {}
  moveTo(_x: number, _y: number): void {}
  lineTo(_x: number, _y: number): void {}
  closePath(): void {}
  stroke(_path?: Path2D): void {}
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
    charge: 0,
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
      charge: 0,
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
