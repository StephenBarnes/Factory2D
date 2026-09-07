import {
  grapherCursorRow,
  signalLineChargeAtRow,
  signalLineRowCount,
  type SignalLine,
  type SignalTraceRecorder,
} from "../game/signal-traces";
import { CIRCUIT_CHARGE_COLORS } from "../simulation/circuit";
import type { World } from "../simulation/world";

const PANEL_PADDING = 8;
const TICK_GUTTER_WIDTH = 28;
const HEADER_HEIGHT = 74;
const CATEGORY_HEIGHT = 24;
const ROW_HEIGHT = 11;
const ROW_GAP = 2;
const MIN_COLUMN_WIDTH = 16;
const MAX_COLUMN_WIDTH = 44;
const MAX_TRACK_WIDTH = 14;
const SCROLL_ROWS_PER_WHEEL_STEP = 3;
const LABEL_ROW_INTERVAL = 5;
const RULE_ROW_INTERVAL = 10;
const COLLAPSED_STORAGE_KEY = "factory2d.signal-panel.collapsed";
const NEUTRAL_CHARGE_COLOR = "#565664";
const TRACK_COLOR = "rgba(120, 220, 202, 0.14)";
const RULE_COLOR = "rgba(201, 162, 90, 0.16)";
const TICK_LABEL_COLOR = "#6e6250";
const MONITOR_LABEL_COLOR = "#e0d5bd";
const GRAPHER_LABEL_COLOR = "#78dcca";
const CURRENT_TICK_COLOR = "rgba(226, 179, 87, 0.75)";
const CURSOR_COLOR = "#f1cc38";
const LABEL_FONT = "700 10px SFMono-Regular, Consolas, monospace";
const TICK_FONT = "600 9px SFMono-Regular, Consolas, monospace";

export interface SignalPanelElements {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly toggleButton: HTMLButtonElement;
}

/**
 * Collapsible right-edge panel drawing every monitor and grapher line as a vertical
 * charge-colored strip, with time (or ROM/checker index) flowing downward.
 */
export class SignalPanel {
  private readonly context: CanvasRenderingContext2D;
  private lines: readonly SignalLine[] = [];
  private linesWorld: World | null = null;
  private linesVersion = -1;
  private linesRevision = -1;
  private firstRow = 0;
  private categoryHeight = 0;
  private following = true;
  private collapsedValue: boolean;
  private drawnKey = "";
  private pointerClientX: number | null = null;
  private pointerClientY = 0;
  private hoveredTileId: number | null = null;
  private hoveredWorld: World | null = null;

  constructor(
    private readonly elements: SignalPanelElements,
    private readonly storage: Storage | null,
    private readonly onHover: (tileId: number | null, world: World | null) => void = () => {},
  ) {
    const context = elements.canvas.getContext("2d");
    if (context === null) {
      throw new Error("Signal panel canvas has no 2D context");
    }
    this.context = context;
    this.collapsedValue = this.readStoredCollapsed();
    this.applyCollapsed();
    elements.toggleButton.addEventListener("click", () => {
      this.setCollapsed(!this.collapsedValue);
    });
    elements.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.scrollBy(Math.sign(event.deltaY) * SCROLL_ROWS_PER_WHEEL_STEP);
    }, { passive: false });
    elements.canvas.addEventListener("pointermove", (event) => {
      this.pointerClientX = event.clientX;
      this.pointerClientY = event.clientY;
      this.refreshHover();
    });
    elements.canvas.addEventListener("pointerleave", () => this.clearHover());
    elements.canvas.addEventListener("pointercancel", () => this.clearHover());
  }

  get visible(): boolean {
    return !this.elements.root.hidden;
  }

  get collapsed(): boolean {
    return this.collapsedValue;
  }

  setCollapsed(collapsed: boolean): void {
    if (collapsed === this.collapsedValue) {
      return;
    }
    this.collapsedValue = collapsed;
    this.applyCollapsed();
    try {
      this.storage?.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // Persisting the collapsed state is a convenience only.
    }
  }

  /** Synchronizes visibility with the board and redraws when any displayed state changed. */
  update(recorder: SignalTraceRecorder, world: World, currentTick: number): void {
    if (this.linesWorld !== world) {
      this.clearHover();
    }
    if (
      this.linesWorld !== world ||
      this.linesVersion !== recorder.version ||
      this.linesRevision !== world.revision
    ) {
      this.lines = recorder.lines(world);
      this.categoryHeight = this.lines.some((line) => line.category !== "") ? CATEGORY_HEIGHT : 0;
      this.linesWorld = world;
      this.linesVersion = recorder.version;
      this.linesRevision = world.revision;
      this.drawnKey = "";
    }
    const shouldShow = this.lines.length > 0;
    if (this.elements.root.hidden === shouldShow) {
      this.elements.root.hidden = !shouldShow;
    }
    if (!shouldShow || this.collapsedValue) {
      this.clearHover();
      return;
    }
    this.draw(currentTick);
    this.refreshHover();
  }

  private scrollBy(rows: number): void {
    const visibleRows = this.visibleRowCount();
    const maxFirstRow = Math.max(0, this.totalRowCount() - visibleRows);
    const nextFirstRow = Math.max(0, Math.min(maxFirstRow, this.firstRow + rows));
    this.firstRow = nextFirstRow;
    this.following = rows > 0 && nextFirstRow === maxFirstRow;
    this.drawnKey = "";
  }

  private columnWidth(width: number): number {
    const columnsWidth = width - PANEL_PADDING * 2 - TICK_GUTTER_WIDTH;
    return Math.max(
      MIN_COLUMN_WIDTH,
      Math.min(MAX_COLUMN_WIDTH, columnsWidth / this.lines.length),
    );
  }

  private refreshHover(): void {
    if (this.pointerClientX === null) {
      return;
    }
    const { canvas } = this.elements;
    if (!this.visible || this.collapsedValue || canvas.hidden || this.lines.length === 0) {
      this.clearHover();
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const x = this.pointerClientX - bounds.left;
    const y = this.pointerClientY - bounds.top;
    const columnsLeft = PANEL_PADDING + TICK_GUTTER_WIDTH;
    const columnsBottom = Math.min(
      canvas.clientHeight - PANEL_PADDING,
      HEADER_HEIGHT + this.categoryHeight + this.visibleRowCount() * ROW_HEIGHT,
    );
    const lineIndex = Math.floor((x - columnsLeft) / this.columnWidth(canvas.clientWidth));
    const line = x >= columnsLeft && x < canvas.clientWidth - PANEL_PADDING &&
      y >= PANEL_PADDING && y < columnsBottom
      ? this.lines[lineIndex]
      : undefined;
    if (line !== undefined && y < this.categoryHeight) {
      canvas.title = line.category;
      this.setHoveredTileId(null, null);
      return;
    }
    canvas.title = line === undefined ? "" :
      [line.category, line.label || displayLabel(line, lineIndex)].filter(Boolean).join(" · ");
    this.setHoveredTileId(line?.id ?? null, line?.world ?? null);
  }

  private clearHover(): void {
    this.pointerClientX = null;
    this.elements.canvas.title = "";
    this.setHoveredTileId(null, null);
  }

  private setHoveredTileId(tileId: number | null, world: World | null): void {
    if (tileId !== this.hoveredTileId || world !== this.hoveredWorld) {
      this.hoveredTileId = tileId;
      this.hoveredWorld = world;
      this.onHover(tileId, world);
    }
  }

  private draw(currentTick: number): void {
    const { canvas } = this.elements;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    const visibleRows = this.visibleRowCount();
    const totalRows = Math.max(this.totalRowCount(), currentTick + 1);
    const maxFirstRow = Math.max(0, totalRows - visibleRows);
    if (this.following) {
      this.firstRow = Math.max(0, Math.min(maxFirstRow, currentTick + 1 - visibleRows));
    } else {
      this.firstRow = Math.min(this.firstRow, maxFirstRow);
    }
    const devicePixelRatio = window.devicePixelRatio || 1;
    const drawKey = `${width}:${height}:${devicePixelRatio}:${currentTick}:${this.firstRow}`;
    if (drawKey === this.drawnKey) {
      return;
    }
    this.drawnKey = drawKey;

    const backingWidth = Math.round(width * devicePixelRatio);
    const backingHeight = Math.round(height * devicePixelRatio);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    const context = this.context;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const columnsLeft = PANEL_PADDING + TICK_GUTTER_WIDTH;
    const columnsWidth = width - columnsLeft - PANEL_PADDING;
    const columnWidth = this.columnWidth(width);
    const trackWidth = Math.min(MAX_TRACK_WIDTH, columnWidth * 0.55);
    const rowsTop = HEADER_HEIGHT + this.categoryHeight;
    const lastRow = this.firstRow + visibleRows;
    const lastDrawnRow = Math.min(lastRow, totalRows);
    const rowsBottom = rowsTop + (lastDrawnRow - this.firstRow) * ROW_HEIGHT;

    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();

    context.font = TICK_FONT;
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let row = this.firstRow; row < lastDrawnRow; row += 1) {
      const y = rowsTop + (row - this.firstRow) * ROW_HEIGHT;
      if (row % RULE_ROW_INTERVAL === 0) {
        context.fillStyle = RULE_COLOR;
        context.fillRect(columnsLeft, y, columnsWidth, 1);
      }
      if (row % LABEL_ROW_INTERVAL === 0) {
        context.fillStyle = TICK_LABEL_COLOR;
        context.fillText(String(row), columnsLeft - 5, y + ROW_HEIGHT / 2);
      }
    }

    if (this.categoryHeight > 0) {
      context.font = LABEL_FONT;
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (let start = 0; start < this.lines.length;) {
        const category = this.lines[start]?.category;
        if (category === undefined) throw new Error(`Signal panel line ${start} is missing`);
        let end = start + 1;
        while (end < this.lines.length && this.lines[end]?.category === category) end += 1;
        const left = columnsLeft + start * columnWidth;
        const right = Math.min(columnsLeft + end * columnWidth, width - PANEL_PADDING);
        if (right > left) {
          context.fillStyle = MONITOR_LABEL_COLOR;
          context.fillText(
            fitLabel(context, category, right - left - 4),
            (left + right) / 2,
            CATEGORY_HEIGHT / 2,
          );
          context.fillStyle = RULE_COLOR;
          context.fillRect(left + 2, CATEGORY_HEIGHT - 2, right - left - 4, 1);
          if (start > 0) context.fillRect(left, CATEGORY_HEIGHT, 1, rowsBottom - CATEGORY_HEIGHT);
        }
        start = end;
      }
    }

    for (let lineIndex = 0; lineIndex < this.lines.length; lineIndex += 1) {
      const line = this.lines[lineIndex];
      if (line === undefined) {
        throw new Error(`Signal panel line ${lineIndex} is missing`);
      }
      const centerX = columnsLeft + columnWidth * (lineIndex + 0.5);
      context.fillStyle = TRACK_COLOR;
      context.fillRect(centerX - 0.5, rowsTop, 1, rowsBottom - rowsTop);

      for (let row = this.firstRow; row < lastRow; row += 1) {
        const charge = signalLineChargeAtRow(line, row);
        if (charge === null) {
          continue;
        }
        const y = rowsTop + (row - this.firstRow) * ROW_HEIGHT;
        const barWidth = charge === 0 ? Math.max(2, trackWidth / 3) : trackWidth;
        context.fillStyle = charge === 0 ? NEUTRAL_CHARGE_COLOR : CIRCUIT_CHARGE_COLORS[charge];
        context.fillRect(centerX - barWidth / 2, y, barWidth, ROW_HEIGHT - ROW_GAP);
      }

      const cursorRow = line.kind === "grapher" ? grapherCursorRow(line) : null;
      if (cursorRow !== null && cursorRow >= this.firstRow && cursorRow < lastRow) {
        const y = rowsTop + (cursorRow - this.firstRow) * ROW_HEIGHT;
        context.strokeStyle = CURSOR_COLOR;
        context.lineWidth = 1;
        context.strokeRect(
          centerX - trackWidth / 2 - 1.5,
          y - 0.5,
          trackWidth + 3,
          ROW_HEIGHT - ROW_GAP + 1,
        );
      }

      context.save();
      context.translate(centerX, rowsTop - 6);
      context.rotate(-Math.PI / 2);
      context.font = LABEL_FONT;
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillStyle = line.kind === "monitor" ? MONITOR_LABEL_COLOR : GRAPHER_LABEL_COLOR;
      const label = displayLabel(line, lineIndex);
      const maxLabelWidth = HEADER_HEIGHT - 10;
      context.fillText(fitLabel(context, label, maxLabelWidth), 0, 0);
      context.restore();
    }

    if (currentTick >= this.firstRow && currentTick < lastRow) {
      const y = rowsTop + (currentTick - this.firstRow) * ROW_HEIGHT + (ROW_HEIGHT - ROW_GAP) / 2;
      context.fillStyle = CURRENT_TICK_COLOR;
      context.fillRect(PANEL_PADDING, y - 0.5, width - PANEL_PADDING * 2, 1);
      context.beginPath();
      context.moveTo(PANEL_PADDING, y - 3);
      context.lineTo(PANEL_PADDING + 4, y);
      context.lineTo(PANEL_PADDING, y + 3);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  private visibleRowCount(): number {
    return Math.max(
      1,
      Math.floor(
        (this.elements.canvas.clientHeight - HEADER_HEIGHT - this.categoryHeight - PANEL_PADDING) / ROW_HEIGHT,
      ),
    );
  }

  private totalRowCount(): number {
    let rows = 0;
    for (const line of this.lines) {
      rows = Math.max(rows, signalLineRowCount(line));
    }
    return rows;
  }

  private applyCollapsed(): void {
    if (this.collapsedValue) {
      this.clearHover();
    }
    this.elements.root.classList.toggle("collapsed", this.collapsedValue);
    this.elements.canvas.hidden = this.collapsedValue;
    this.elements.toggleButton.textContent = this.collapsedValue ? "◀" : "▶";
    this.elements.toggleButton.setAttribute("aria-expanded", String(!this.collapsedValue));
    this.elements.toggleButton.title = this.collapsedValue
      ? "Expand signal panel"
      : "Collapse signal panel";
    this.drawnKey = "";
  }

  private readStoredCollapsed(): boolean {
    try {
      return this.storage?.getItem(COLLAPSED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }
}

function displayLabel(line: SignalLine, lineIndex: number): string {
  if (line.label !== "") {
    return line.label.toUpperCase();
  }
  return `${line.kind === "monitor" ? "MONITOR" : "LORE"} ${lineIndex + 1}`;
}

function fitLabel(context: CanvasRenderingContext2D, label: string, width: number): string {
  if (context.measureText(label).width <= width) return label;
  let end = label.length;
  while (end > 0 && context.measureText(`${label.slice(0, end)}…`).width > width) end -= 1;
  return `${label.slice(0, end)}…`;
}
