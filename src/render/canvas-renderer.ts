import { TILE_DEFINITIONS, TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";

export interface GridCell {
  readonly x: number;
  readonly y: number;
}

const DESIGN_TILE_SIZE = 32;

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly world: World;

  private cellSize = DESIGN_TILE_SIZE;
  private originX = 0;
  private originY = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private hoverX = -1;
  private hoverY = -1;

  constructor(canvas: HTMLCanvasElement, world: World) {
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D is not supported by this browser");
    }

    this.canvas = canvas;
    this.context = context;
    this.world = world;
  }

  render(): void {
    this.resizeBackingStore();

    const { context } = this;
    context.clearRect(0, 0, this.viewportWidth, this.viewportHeight);
    context.fillStyle = "#0b0f14";
    context.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    this.drawGrid();
    this.drawTiles();
    this.drawHover();
  }

  cellFromClientPoint(clientX: number, clientY: number): GridCell | null {
    const bounds = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - bounds.left - this.originX) / this.cellSize);
    const y = Math.floor((clientY - bounds.top - this.originY) / this.cellSize);

    if (x < 0 || x >= this.world.width || y < 0 || y >= this.world.height) {
      return null;
    }
    return { x, y };
  }

  setHover(cell: GridCell | null): void {
    this.hoverX = cell?.x ?? -1;
    this.hoverY = cell?.y ?? -1;
  }

  private resizeBackingStore(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const devicePixelRatio = window.devicePixelRatio || 1;
    const backingWidth = Math.round(width * devicePixelRatio);
    const backingHeight = Math.round(height * devicePixelRatio);

    if (this.canvas.width !== backingWidth || this.canvas.height !== backingHeight) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
    }

    this.context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.context.imageSmoothingEnabled = false;
    this.viewportWidth = width;
    this.viewportHeight = height;

    const fittedSize = Math.floor(
      Math.min(width / this.world.width, height / this.world.height, DESIGN_TILE_SIZE),
    );
    this.cellSize = Math.max(12, fittedSize);
    this.originX = Math.floor((width - this.world.width * this.cellSize) / 2);
    this.originY = Math.floor((height - this.world.height * this.cellSize) / 2);
  }

  private drawGrid(): void {
    const boardWidth = this.world.width * this.cellSize;
    const boardHeight = this.world.height * this.cellSize;
    const { context } = this;

    context.fillStyle = "#121923";
    context.fillRect(this.originX, this.originY, boardWidth, boardHeight);
    context.strokeStyle = "#202a35";
    context.lineWidth = 1;
    context.beginPath();

    for (let x = 0; x <= this.world.width; x += 1) {
      const lineX = this.originX + x * this.cellSize + 0.5;
      context.moveTo(lineX, this.originY);
      context.lineTo(lineX, this.originY + boardHeight);
    }
    for (let y = 0; y <= this.world.height; y += 1) {
      const lineY = this.originY + y * this.cellSize + 0.5;
      context.moveTo(this.originX, lineY);
      context.lineTo(this.originX + boardWidth, lineY);
    }
    context.stroke();

    context.strokeStyle = "#354250";
    context.strokeRect(this.originX + 0.5, this.originY + 0.5, boardWidth, boardHeight);
  }

  private drawTiles(): void {
    for (let y = 0; y < this.world.height; y += 1) {
      for (let x = 0; x < this.world.width; x += 1) {
        const kind = this.world.kindAt(x, y);
        if (kind !== TileKind.Empty) {
          this.drawTile(x, y, kind);
        }
      }
    }
  }

  private drawTile(x: number, y: number, kind: TileKind): void {
    const definition = TILE_DEFINITIONS[kind];
    const left = this.originX + x * this.cellSize + 2;
    const top = this.originY + y * this.cellSize + 2;
    const size = this.cellSize - 4;
    const edge = Math.max(2, Math.floor(this.cellSize / 8));
    const { context } = this;

    context.fillStyle = definition.shadow;
    context.fillRect(left, top, size, size);
    context.fillStyle = definition.fill;
    context.fillRect(left, top, size - edge, size - edge);
    context.fillStyle = definition.highlight;
    context.fillRect(left + edge, top + edge, size - edge * 2, Math.max(2, edge / 2));

    if (kind === TileKind.Stone) {
      context.strokeStyle = "#525d68";
      context.beginPath();
      context.moveTo(left + size * 0.35, top + edge);
      context.lineTo(left + size * 0.48, top + size * 0.45);
      context.lineTo(left + size * 0.37, top + size - edge);
      context.stroke();
    } else if (kind === TileKind.Sand) {
      context.fillStyle = "#8d5b26";
      const grainSize = Math.max(1, Math.floor(this.cellSize / 16));
      context.fillRect(left + size * 0.25, top + size * 0.42, grainSize, grainSize);
      context.fillRect(left + size * 0.68, top + size * 0.7, grainSize, grainSize);
    }
  }

  private drawHover(): void {
    if (this.hoverX < 0 || this.hoverY < 0) {
      return;
    }

    this.context.strokeStyle = "#78dcca";
    this.context.lineWidth = 2;
    this.context.strokeRect(
      this.originX + this.hoverX * this.cellSize + 1,
      this.originY + this.hoverY * this.cellSize + 1,
      this.cellSize - 2,
      this.cellSize - 2,
    );
  }
}
