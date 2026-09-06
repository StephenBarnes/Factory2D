import { drawTile } from "../render/tile-renderer";
import { Direction, orientationForKind, TileKind } from "../simulation/tile";
import type { BuildTool } from "./canvas-interaction-controller";

const ICON_SIZE = 14;
const CURSOR_OFFSET = 9;

/** Pointer-only companion to the board preview, using the palette's tile and tool artwork. */
export class ToolCursor {
  private readonly tileCanvas = document.createElement("canvas");
  private readonly swatch = document.createElement("span");
  private drawnKey = "";

  constructor(
    boardCanvas: HTMLCanvasElement,
    private readonly element: HTMLElement,
  ) {
    this.swatch.setAttribute("aria-hidden", "true");
    element.append(this.tileCanvas, this.swatch);
    window.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" || event.target !== boardCanvas) {
        this.hide();
        return;
      }
      const bounds = boardCanvas.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX >= bounds.right ||
          event.clientY < bounds.top || event.clientY >= bounds.bottom) {
        this.hide();
        return;
      }
      element.hidden = false;
      const left = Math.max(0, Math.min(event.clientX + CURSOR_OFFSET, window.innerWidth - ICON_SIZE));
      const top = Math.max(0, Math.min(event.clientY + 4, window.innerHeight - ICON_SIZE));
      element.style.transform = `translate(${left}px, ${top}px)`;
    });
    boardCanvas.addEventListener("pointerleave", () => this.hide());
    boardCanvas.addEventListener("pointercancel", () => this.hide());
    window.addEventListener("blur", () => this.hide());
  }

  hide(): void {
    this.element.hidden = true;
  }

  update(tool: BuildTool, kind: TileKind, orientation: Direction): void {
    const pixelRatio = window.devicePixelRatio || 1;
    const resolvedOrientation = orientationForKind(kind, orientation);
    const key = `${tool}:${kind}:${resolvedOrientation}:${pixelRatio}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    this.element.dataset.tool = tool;
    this.tileCanvas.hidden = tool !== "tile";
    this.swatch.hidden = tool === "tile";
    if (tool !== "tile") {
      this.swatch.className = `swatch ${tool}-swatch`;
      this.swatch.textContent = tool === "text-box" ? "T" : "";
      return;
    }
    const backingSize = Math.max(1, Math.round(ICON_SIZE * pixelRatio * 2));
    this.tileCanvas.width = backingSize;
    this.tileCanvas.height = backingSize;
    const context = this.tileCanvas.getContext("2d");
    if (context === null) throw new Error("Cursor preview requires Canvas 2D");
    context.setTransform(backingSize / ICON_SIZE, 0, 0, backingSize / ICON_SIZE, 0, 0);
    drawTile(context, 0, 0, ICON_SIZE, kind, resolvedOrientation);
  }
}
