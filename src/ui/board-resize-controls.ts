import { GridRegion } from "../game/grid-region";
import type { BoardEdge } from "../game/sandbox-puzzle-authoring";
import type { CanvasRenderer, GridRegionScreenBounds } from "../render/canvas-renderer";
import {
  MAX_BOARD_HEIGHT,
  MAX_BOARD_WIDTH,
  MIN_BOARD_HEIGHT,
  MIN_BOARD_WIDTH,
} from "../simulation/board-export";
import type { World } from "../simulation/world";
import "./board-resize-controls.css";

const EDGES: readonly BoardEdge[] = ["top", "right", "bottom", "left"];
const GROUP_WIDTH = 64;
const GROUP_HEIGHT = 32;
const EDGE_GAP = 6;
const EDGE_EPSILON = 1e-6;

interface EdgeControls {
  readonly edge: BoardEdge;
  readonly element: HTMLDivElement;
  readonly add: HTMLButtonElement;
  readonly remove: HTMLButtonElement;
}

/** Canvas-local controls; the caller owns sandbox/root-view availability and edits. */
export class BoardResizeControls {
  private readonly element = document.createElement("div");
  private readonly controls: EdgeControls[] = [];
  private region: GridRegion | null = null;
  private boardWidth = 0;
  private boardHeight = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private bounds: GridRegionScreenBounds | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    onResize: (edge: BoardEdge, delta: 1 | -1) => void,
  ) {
    const parent = canvas.parentElement;
    if (parent === null) throw new Error("Board resize controls require a mounted canvas");
    this.element.className = "board-resize-controls";
    this.element.hidden = true;
    this.element.style.setProperty("--board-resize-width", `${GROUP_WIDTH}px`);
    this.element.style.setProperty("--board-resize-height", `${GROUP_HEIGHT}px`);
    for (const edge of EDGES) {
      const element = document.createElement("div");
      element.className = "board-resize-group";
      element.dataset.edge = edge;
      element.setAttribute("role", "group");
      element.setAttribute("aria-label", `Resize ${edge} edge`);
      const unit = edge === "top" || edge === "bottom" ? "row" : "column";
      const button = (delta: 1 | -1): HTMLButtonElement => {
        const result = document.createElement("button");
        result.type = "button";
        result.textContent = delta === 1 ? "+" : "−";
        result.title = `${delta === 1 ? "Add" : "Remove"} ${unit} at ${edge}`;
        result.setAttribute("aria-label", result.title);
        result.addEventListener("click", () => onResize(edge, delta));
        return result;
      };
      const remove = button(-1);
      const add = button(1);
      element.append(remove, add);
      this.element.append(element);
      this.controls.push({ edge, element, add, remove });
    }
    parent.append(this.element);
  }

  update(renderer: CanvasRenderer, world: World, visible: boolean): void {
    if (this.element.hidden === visible) this.element.hidden = !visible;
    if (!visible) return;

    if (world.width !== this.boardWidth || world.height !== this.boardHeight) {
      this.boardWidth = world.width;
      this.boardHeight = world.height;
      this.region = new GridRegion([{ x: 0, y: 0, width: world.width, height: world.height }]);
      this.bounds = null;
      for (const controls of this.controls) {
        const row = controls.edge === "top" || controls.edge === "bottom";
        controls.add.disabled = row ? world.height >= MAX_BOARD_HEIGHT : world.width >= MAX_BOARD_WIDTH;
        controls.remove.disabled = row ? world.height <= MIN_BOARD_HEIGHT : world.width <= MIN_BOARD_WIDTH;
      }
    }
    if (this.region === null) throw new Error("Board resize controls require a nonempty board region");
    const bounds = renderer.screenBoundsForGridRegion(this.region);
    if (bounds === null) throw new Error("Board resize controls require screen bounds for the board");
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (
      width === this.viewportWidth && height === this.viewportHeight &&
      bounds.left === this.bounds?.left && bounds.right === this.bounds.right &&
      bounds.top === this.bounds.top && bounds.bottom === this.bounds.bottom
    ) return;
    this.bounds = bounds;
    this.viewportWidth = width;
    this.viewportHeight = height;

    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    for (const controls of this.controls) {
      const horizontal = controls.edge === "top" || controls.edge === "bottom";
      const side = bounds[controls.edge];
      const sideLimit = horizontal ? height : width;
      const start = horizontal ? bounds.left : bounds.top;
      const end = horizontal ? bounds.right : bounds.bottom;
      const spanLimit = horizontal ? width : height;
      const hidden = width <= 0 || height <= 0 || side < -EDGE_EPSILON ||
        side > sideLimit + EDGE_EPSILON || end < -EDGE_EPSILON || start > spanLimit + EDGE_EPSILON;
      if (controls.element.hidden !== hidden) controls.element.hidden = hidden;
      if (hidden) continue;

      const groupWidth = horizontal ? GROUP_WIDTH : GROUP_HEIGHT;
      const groupHeight = horizontal ? GROUP_HEIGHT : GROUP_WIDTH;
      const x = horizontal ? centerX : side + (controls.edge === "left" ? -1 : 1) * (groupWidth / 2 + EDGE_GAP);
      const y = horizontal ? side + (controls.edge === "top" ? -1 : 1) * (groupHeight / 2 + EDGE_GAP) : centerY;
      controls.element.style.left = `${clampCenter(x, width, groupWidth)}px`;
      controls.element.style.top = `${clampCenter(y, height, groupHeight)}px`;
    }
  }
}

function clampCenter(center: number, viewportSize: number, groupSize: number): number {
  const margin = Math.min(viewportSize / 2, groupSize / 2 + EDGE_GAP);
  return Math.max(margin, Math.min(viewportSize - margin, center));
}
