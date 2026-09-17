import type { GridRectangle, GridRegion } from "../game/grid-region";
import type { TileSelectionOverlay } from "../game/tile-selection";
import { CIRCUIT_CHARGE_COLORS, type Charge } from "../simulation/circuit";
import { runeArrayPortCellIndex } from "../simulation/rune-array";
import {
  Direction,
  directionX,
  directionY,
  oppositeDirection,
  mirroringForKind,
  orientedDirection,
  TILE_DEFINITIONS,
  TILE_KINDS,
  TileKind,
  WeldSide,
} from "../simulation/tile";
import type { World } from "../simulation/world";
import type { TextBox } from "../simulation/text-box";
import { WorldFeature } from "../simulation/world-features";
import { expectDefined } from "../util/assert";
import type { GridCell, GridEdge, GridPoint } from "./grid-drag";
import { WELD_HIT_RADIUS } from "./grid-drag";
import { createBodyCell, populateBodyCell } from "./body-cells";
import { tileAppearance } from "./appearance";
import { RotationInterpolation, type RotationTransform } from "./rotation-interpolation";
import { TranslationInterpolation } from "./translation-interpolation";
import {
  type BodyCell,
  createBodyPath,
  DECORATION_CELL_SIZE,
  drawBody,
  drawTile,
  setCircuitPortCharge,
} from "./tile-renderer";
import { watchWeldAnimation, type WeldAnimation } from "../simulation/weld-animation";
import { drawWeldSparks } from "./weld-sparks";
import { watchProcessingAnimation, type ProcessingAnimation } from "../simulation/processing-animation";
import { drawProcessingParticles } from "./processing-particles";
import { watchShatterAnimation, type ShatterAnimation } from "../simulation/shatter-animation";
import { drawShatterParticles } from "./shatter-particles";


const MAX_TILE_SIZE = 64;
const MIN_MANUAL_TILE_SIZE = 2;
const GRID_EDGE_EPSILON = 1e-6;
const EDITABLE_REGION_DASH_PATTERN = [4, 4];
const PORT_CELL_DASH_PATTERN = [3, 3];
const NESTED_FRAME_COLOR = "#7a88c4";
const PORT_CELL_COLOR = "rgb(199 211 244 / 55%)";
const EDIT_REJECTION_DURATION_MS = 700;
const EDIT_REJECTION_DASH_PATTERN: readonly number[] = [];
/** Below this screen-space size, procedural details cost more than they communicate. */
const LOW_DETAIL_CELL_SIZE = 6;
// Measure and draw at a normal font size: subpixel fonts have inconsistent browser baselines.
const TEXT_BOX_FONT_SCALE = 100;
const TEXT_BOX_FONT = '20px Georgia, "Times New Roman", serif';
const TEXT_BOX_LINE_HEIGHT = 0.26;
const TEXT_BOX_HORIZONTAL_PADDING = 0.18;
const TEXT_BOX_TOP_PADDING = 0.16;
const TEXT_BOX_BOTTOM_PADDING = 0.06;

interface TextBoxLayout {
  readonly lines: readonly string[];
  readonly ascent: number;
  readonly lineHeight: number;
}

/** Supplies the containing rune array's side charges while its inner board is displayed. */
export interface NestedBoardView {
  portCharge(side: Direction): Charge;
}


interface CachedBodyGeometry {
  readonly cells: readonly BodyCell[];
  readonly path: Path2D;
}

interface CachedBody extends CachedBodyGeometry {
  readonly minX: number;
  readonly minY: number;
  /** Exclusive grid bound. */
  readonly maxX: number;
  /** Exclusive grid bound. */
  readonly maxY: number;
}

interface CachedMotionBodies {
  revision: number;
  rotationRevision: number;
  bodies: readonly CachedBody[];
}
export interface GridRegionScreenBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}


export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly world: World;
  private readonly editableRegion: GridRegion | null;
  private readonly nestedView: NestedBoardView | null;
  /** Cells of margin kept around the board when fitting, so nested port conduits stay visible. */
  private readonly fitMargin: number;
  private authoredEditableRegion: GridRegion | null = null;
  private authoredEditableRegionDraft: GridRectangle | null = null;
  private tileSelectionOverlay: TileSelectionOverlay | null = null;
  private tileSelectionDraft: GridRegion | null = null;
  private textBoxPreview: TextBox | null = null;
  private readonly textBoxLayouts = new WeakMap<TextBox, TextBoxLayout>();
  private rejectedRegionUntil = 0;
  private readonly rejectedCells = new Map<number, number>();
  private readonly weldAnimations: Map<number, WeldAnimation>;
  private readonly processingAnimations: Map<number, ProcessingAnimation>;
  private readonly shatterAnimations: Map<number, ShatterAnimation>;

  private cellSize = MAX_TILE_SIZE;
  private originX = 0;
  private originY = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private viewCenterX: number;
  private viewCenterY: number;
  private viewInitialized = false;
  private viewModified = false;
  /** Per-cell body stamp: 0 = unvisited, otherwise the body's start index + 1. */
  private bodyStamps = new Int32Array(0);
  private bodyStack = new Int32Array(0);
  /** Current cached body index + 1 for each occupied cell; 0 means uncached. */
  private bodyIndexByCell = new Int32Array(0);
  private cachedKinds = new Uint8Array(0);
  private cachedRightWelds = new Uint8Array(0);
  private cachedDownWelds = new Uint8Array(0);
  private dirtyCellIndices = new Int32Array(0);
  private readonly bodyCells: BodyCell[] = [];
  private cachedWorldRevision = -1;
  private cachedWorldGeometryRevision = -1;
  private cachedCellSize = 0;
  private renderedBevels = tileAppearance.bevels;
  private readonly cachedBodies: Array<CachedBody | null> = [];
  private readonly freeCachedBodyIndices: number[] = [];
  private readonly cachedSelectionBodies: CachedBodyGeometry[] = [];
  private cachedSelectionOverlay: TileSelectionOverlay | null = null;
  private cachedSelectionCellSize = 0;
  private selectionBodyStamps = new Int32Array(0);
  private selectionBodyStack = new Int32Array(0);
  private selectionCellIndices = new Int32Array(0);
  private readonly selectionBodyCells: BodyCell[] = [];
  /** Low-detail cells already carry interpolated positions, so only kind needs batching. */
  private readonly lowDetailPaths: Array<Path2D | undefined> = new Array(TILE_KINDS.length);
  private readonly motionBodies = new WeakMap<CachedBody, CachedMotionBodies>();
  private hoverX = -1;
  private hoverY = -1;
  private hoverEdge: GridEdge | null = null;
  private hoverKind = TileKind.Empty;
  private hoverOrientation = Direction.Up;
  private hoverMirrored = false;
  private highlightedTileId: number | null = null;
  private highlightedTileIndex = -1;
  private highlightedGeometryRevision = -1;
  private footprintBounds: GridRectangle | null = null;
  private renderInvalidated = true;
  private lightMode = false;
  private renderedWorldRevision = -1;
  private renderedPreviousWorld: World | null = null;
  private renderedPreviousWorldRevision = -1;
  private readonly previousRotatorDirections = new Map<number, Direction>();
  private readonly rotationInterpolation = new RotationInterpolation();
  private readonly translationInterpolation = new TranslationInterpolation();
  private renderedProgress = -1;
  private renderedNestedPortCharges = -1;
  private hasTimeDependentVisuals = false;

  constructor(
    canvas: HTMLCanvasElement,
    world: World,
    editableRegion: GridRegion | null = null,
    nestedView: NestedBoardView | null = null,
  ) {
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D is not supported by this browser");
    }

    this.canvas = canvas;
    this.context = context;
    this.world = world;
    this.weldAnimations = watchWeldAnimation(world);
    this.processingAnimations = watchProcessingAnimation(world);
    this.shatterAnimations = watchShatterAnimation(world);
    this.editableRegion = editableRegion;
    this.nestedView = nestedView;
    this.fitMargin = nestedView === null ? 0 : 1;
    this.viewCenterX = world.width / 2;
    this.viewCenterY = world.height / 2;
  }

  setEditableRegionAuthoring(
    region: GridRegion | null,
    draftRectangle: GridRectangle | null,
  ): void {
    if (
      this.authoredEditableRegion !== region ||
      this.authoredEditableRegionDraft !== draftRectangle
    ) {
      this.renderInvalidated = true;
      this.authoredEditableRegion = region;
      this.authoredEditableRegionDraft = draftRectangle;
    }
  }
  setTileSelection(
    overlay: TileSelectionOverlay | null,
    draft: GridRegion | null,
  ): void {
    if (this.tileSelectionOverlay !== overlay || this.tileSelectionDraft !== draft) {
      this.renderInvalidated = true;
      this.tileSelectionOverlay = overlay;
      this.tileSelectionDraft = draft;
    }
  }

  setTextBoxPreview(box: TextBox | null): void {
    if (this.textBoxPreview !== box) {
      this.textBoxPreview = box;
      this.renderInvalidated = true;
    }
  }

  screenBoundsForGridRegion(region: GridRegion): GridRegionScreenBounds | null {
    if (region.rectangles.length === 0) {
      return null;
    }
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const rectangle of region.rectangles) {
      left = Math.min(left, this.originX + rectangle.x * this.cellSize);
      top = Math.min(top, this.originY + rectangle.y * this.cellSize);
      right = Math.max(right, this.originX + (rectangle.x + rectangle.width) * this.cellSize);
      bottom = Math.max(bottom, this.originY + (rectangle.y + rectangle.height) * this.cellSize);
    }
    return { left, top, right, bottom };
  }



  fitBoardToViewport(): void {
    this.resizeBackingStore();
    this.fitViewToViewport();
    this.viewInitialized = true;
    this.viewModified = false;
    this.renderInvalidated = true;
  }

  /** Carries the player's current camera across a renderer remount on the same canvas. */
  preserveViewFrom(renderer: CanvasRenderer): void {
    if (!renderer.viewInitialized) {
      return;
    }
    this.cellSize = renderer.cellSize;
    this.viewCenterX = renderer.viewCenterX;
    this.viewCenterY = renderer.viewCenterY;
    this.viewInitialized = true;
    // A preserved camera is now intentional, even if the source was the initial fitted view.
    this.viewModified = true;
    this.resizeBackingStore();
    this.renderInvalidated = true;
  }

  zoomAtClientPoint(clientX: number, clientY: number, wheelDeltaY: number): void {
    this.resizeBackingStore();
    const bounds = this.canvas.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const gridX = (localX - this.originX) / this.cellSize;
    const gridY = (localY - this.originY) / this.cellSize;
    const minimumSize = Math.min(MIN_MANUAL_TILE_SIZE, this.cellSize);
    const nextSize = Math.max(
      minimumSize,
      Math.min(MAX_TILE_SIZE, this.cellSize * Math.exp(-wheelDeltaY * 0.0015)),
    );
    if (nextSize === this.cellSize) {
      return;
    }

    this.cellSize = nextSize;
    this.viewCenterX = gridX - (localX - this.viewportWidth / 2) / nextSize;
    this.viewCenterY = gridY - (localY - this.viewportHeight / 2) / nextSize;
    this.viewModified = true;
    this.updateOrigin();
    this.renderInvalidated = true;
  }

  /** Moves the rendered board by the supplied screen-space delta. */
  panByPixels(deltaX: number, deltaY: number): void {
    this.viewCenterX -= deltaX / this.cellSize;
    this.viewCenterY -= deltaY / this.cellSize;
    this.viewModified = true;
    this.updateOrigin();
    this.renderInvalidated = true;
  }

  flashRejectedRegion(): void {
    this.rejectedRegionUntil = performance.now() + EDIT_REJECTION_DURATION_MS;
    this.renderInvalidated = true;
  }

  flashRejectedWeld(x1: number, y1: number, x2: number, y2: number): void {
    const expiresAt = performance.now() + EDIT_REJECTION_DURATION_MS;
    this.rejectedCells.set(y1 * this.world.width + x1, expiresAt);
    this.rejectedCells.set(y2 * this.world.width + x2, expiresAt);
    this.renderInvalidated = true;
  }

  render(
    previousWorld: World | null = null,
    progress = 1,
    animationTime = 0,
    lightMode = false,
    animationsEnabled = true,
  ): void {
    if (this.renderedBevels !== tileAppearance.bevels) {
      this.renderedBevels = tileAppearance.bevels;
      this.renderInvalidated = true;
    }
    if (this.lightMode !== lightMode) {
      this.lightMode = lightMode;
      this.renderInvalidated = true;
    }
    this.resizeBackingStore();
    if (!animationsEnabled || this.cellSize < DECORATION_CELL_SIZE) {
      // Discard hidden bursts before frame invalidation so they neither redraw nor replay later.
      this.processingAnimations.clear();
    }
    if (!animationsEnabled || this.cellSize < 6) {
      this.shatterAnimations.clear();
    }
    const boundedProgress = Math.max(0, Math.min(1, progress));
    const previousWorldRevision = previousWorld?.revision ?? -1;
    const nestedPortCharges = this.nestedPortChargeKey();
    if (
      !this.renderInvalidated &&
      !this.hasTimeDependentVisuals &&
      this.weldAnimations.size === 0 &&
      this.processingAnimations.size === 0 &&
      this.shatterAnimations.size === 0 &&
      this.renderedWorldRevision === this.world.revision &&
      this.renderedPreviousWorld === previousWorld &&
      this.renderedPreviousWorldRevision === previousWorldRevision &&
      this.renderedProgress === boundedProgress &&
      this.renderedNestedPortCharges === nestedPortCharges
    ) {
      return;
    }

    this.hasTimeDependentVisuals = false;
    const { context } = this;
    context.clearRect(0, 0, this.viewportWidth, this.viewportHeight);
    context.fillStyle = this.lightMode ? "#d8ccb5" : "#0d0a07";
    context.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    this.drawGrid();
    this.drawNestedPorts(animationTime);
    this.drawTiles(previousWorld, boundedProgress, animationTime);
    if (drawShatterParticles(
      context, this.shatterAnimations, this.world.width, this.world.height,
      this.originX, this.originY, this.cellSize,
    )) {
      this.hasTimeDependentVisuals = true;
    }
    this.drawEditableRegion();
    this.drawEditableRegionAuthoring();
    this.drawTileSelection(animationTime);
    this.drawHover(animationTime);
    this.drawTextBoxes();
    this.drawHighlightedTile(previousWorld, boundedProgress);
    this.drawFootprint();
    this.drawEditRejection();
    if (drawWeldSparks(
      context, this.weldAnimations, this.world.width, this.world.height,
      this.originX, this.originY, this.cellSize,
    )) {
      this.hasTimeDependentVisuals = true;
    }
    if (drawProcessingParticles(
      context, this.processingAnimations, this.world.width, this.world.height,
      this.originX, this.originY, this.cellSize,
    )) {
      this.hasTimeDependentVisuals = true;
    }

    this.renderInvalidated = false;
    this.renderedWorldRevision = this.world.revision;
    this.renderedPreviousWorld = previousWorld;
    this.renderedPreviousWorldRevision = previousWorldRevision;
    this.renderedProgress = boundedProgress;
    this.renderedNestedPortCharges = nestedPortCharges;
  }

  /** Copies the visible board from the last rendered frame, excluding off-board port cells. */
  cropRenderedBoard(): HTMLCanvasElement {
    // Use the rendering transform: rounded backing dimensions can differ from CSS size × DPR.
    const transform = this.context.getTransform();
    const left = Math.max(0, Math.floor(this.originX * transform.a));
    const top = Math.max(0, Math.floor(this.originY * transform.d));
    const right = Math.min(
      this.canvas.width,
      Math.ceil((this.originX + this.world.width * this.cellSize) * transform.a),
    );
    const bottom = Math.min(
      this.canvas.height,
      Math.ceil((this.originY + this.world.height * this.cellSize) * transform.d),
    );
    if (!(right > left && bottom > top)) {
      throw new Error("Cannot export the grid image: the rendered board is not visible");
    }

    // Round outwards to retain antialiased edge pixels, then copy without resampling.
    const image = document.createElement("canvas");
    image.width = right - left;
    image.height = bottom - top;
    const context = image.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D is not supported by this browser");
    }
    context.drawImage(
      this.canvas,
      left,
      top,
      image.width,
      image.height,
      0,
      0,
      image.width,
      image.height,
    );
    return image;
  }

  /** Fits both dimensions to the text, wrapping only at the board's full width. */
  fitTextBox(box: TextBox): TextBox | null {
    this.context.save();
    this.context.font = TEXT_BOX_FONT;
    let longestLine = 0;
    for (const line of box.text.split(/\r\n?|\n/)) {
      longestLine = Math.max(longestLine, this.context.measureText(line).width);
    }
    const width = Math.min(
      this.world.width,
      (Math.ceil(longestLine) + 1) / TEXT_BOX_FONT_SCALE + TEXT_BOX_HORIZONTAL_PADDING * 2,
    );
    const sizedBox = { ...box, width };
    const layout = this.layoutTextBox(sizedBox);
    const contentWidth = (width - TEXT_BOX_HORIZONTAL_PADDING * 2) * TEXT_BOX_FONT_SCALE;
    const fitsWidth = layout.lines.every((line) => this.context.measureText(line).width <= contentWidth);
    this.context.restore();
    const height = layout.lines.length * layout.lineHeight + TEXT_BOX_TOP_PADDING + TEXT_BOX_BOTTOM_PADDING;
    if (!fitsWidth || height > this.world.height) return null;
    return {
      ...sizedBox,
      x: Math.min(box.x, this.world.width - width),
      y: Math.min(box.y, this.world.height - height),
      height,
    };
  }

  private drawTextBoxes(): void {
    if (this.world.textBoxes.length === 0 && this.textBoxPreview === null) return;
    const { context } = this;
    context.save();
    context.translate(this.originX, this.originY);
    context.scale(this.cellSize, this.cellSize);
    context.font = TEXT_BOX_FONT;
    context.textBaseline = "alphabetic";
    context.textAlign = "left";
    for (const box of this.world.textBoxes) {
      if (box.id !== this.textBoxPreview?.id) this.drawTextBox(box, false);
    }
    if (this.textBoxPreview !== null) this.drawTextBox(this.textBoxPreview, true);
    context.restore();
  }

  private drawTextBox(box: TextBox, preview: boolean): void {
    const { context } = this;
    const paddingX = Math.min(TEXT_BOX_HORIZONTAL_PADDING, box.width / 4);
    const paddingTop = Math.min(TEXT_BOX_TOP_PADDING, box.height / 2);
    const paddingBottom = Math.min(TEXT_BOX_BOTTOM_PADDING, box.height / 4);
    context.save();
    context.fillStyle = preview ? "rgb(38 57 53 / 92%)" : "rgb(29 22 15 / 92%)";
    context.strokeStyle = preview ? "#78dcca" : "#c1a576";
    context.lineWidth = 0.025;
    if (preview) context.setLineDash([0.12, 0.08]);
    context.fillRect(box.x, box.y, box.width, box.height);
    context.strokeRect(box.x, box.y, box.width, box.height);
    context.beginPath();
    context.rect(box.x + paddingX, box.y + paddingTop, box.width - paddingX * 2, box.height - paddingTop - paddingBottom);
    context.clip();
    context.fillStyle = "#f4e4c5";
    let layout = this.textBoxLayouts.get(box);
    if (layout === undefined) {
      layout = this.layoutTextBox(box);
      this.textBoxLayouts.set(box, layout);
    }
    context.scale(1 / TEXT_BOX_FONT_SCALE, 1 / TEXT_BOX_FONT_SCALE);
    for (let index = 0; index < layout.lines.length; index += 1) {
      const top = box.y + paddingTop + index * layout.lineHeight;
      if (top >= box.y + box.height - paddingBottom) break;
      context.fillText(
        expectDefined(layout.lines[index], "Text box line is missing"),
        (box.x + paddingX) * TEXT_BOX_FONT_SCALE,
        (top + layout.ascent) * TEXT_BOX_FONT_SCALE,
      );
    }
    context.restore();
  }

  private layoutTextBox(box: TextBox): TextBoxLayout {
    const padding = Math.min(TEXT_BOX_HORIZONTAL_PADDING, box.width / 4);
    const lines = this.wrapTextBox(box.text, (box.width - padding * 2) * TEXT_BOX_FONT_SCALE);
    const reference = this.context.measureText("Mg");
    let ascent = reference.actualBoundingBoxAscent;
    let descent = reference.actualBoundingBoxDescent;
    for (const line of lines) {
      const metrics = this.context.measureText(line);
      ascent = Math.max(ascent, metrics.actualBoundingBoxAscent);
      descent = Math.max(descent, metrics.actualBoundingBoxDescent);
    }
    return {
      lines,
      ascent: ascent / TEXT_BOX_FONT_SCALE,
      lineHeight: Math.max(TEXT_BOX_LINE_HEIGHT, (ascent + descent) / TEXT_BOX_FONT_SCALE),
    };
  }

  private wrapTextBox(text: string, width: number): readonly string[] {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r\n?|\n/)) {
      let line = "";
      for (const word of paragraph.split(/(\s+)/u)) {
        if (this.context.measureText(line + word).width <= width) {
          line += word;
          continue;
        }
        if (line !== "") {
          lines.push(line.trimEnd());
          line = "";
        }
        if (word.trim() === "") continue;
        for (const character of word) {
          if (line !== "" && this.context.measureText(line + character).width > width) {
            lines.push(line);
            line = "";
          }
          line += character;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  private nestedPortChargeKey(): number {
    if (this.nestedView === null) {
      return 0;
    }
    let key = 0;
    for (let value = Direction.Up; value <= Direction.Left; value += 1) {
      key |= (this.nestedView.portCharge(value as Direction) + 1) << (value * 2);
    }
    return key;
  }

  gridPointFromClientPoint(clientX: number, clientY: number): GridPoint {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - bounds.left - this.originX) / this.cellSize,
      y: (clientY - bounds.top - this.originY) / this.cellSize,
    };
  }

  cellFromGridPoint(point: GridPoint): GridCell | null {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);

    if (x < 0 || x >= this.world.width || y < 0 || y >= this.world.height) {
      return null;
    }
    return { x, y };
  }

  edgeFromGridPoint(point: GridPoint): GridEdge | null {
    if (point.x < 0 || point.x > this.world.width || point.y < 0 || point.y > this.world.height) {
      return null;
    }

    const verticalLine = Math.round(point.x);
    const horizontalLine = Math.round(point.y);
    const verticalDistance = Math.abs(point.x - verticalLine);
    const horizontalDistance = Math.abs(point.y - horizontalLine);

    if (
      verticalLine > 0 &&
      verticalLine < this.world.width &&
      verticalDistance <= WELD_HIT_RADIUS &&
      Math.abs(point.y - Math.floor(point.y) - 0.5) <= WELD_HIT_RADIUS
    ) {
      const y = Math.floor(point.y);
      return { x1: verticalLine - 1, y1: y, x2: verticalLine, y2: y };
    }
    if (
      horizontalLine > 0 &&
      horizontalLine < this.world.height &&
      horizontalDistance <= WELD_HIT_RADIUS &&
      Math.abs(point.x - Math.floor(point.x) - 0.5) <= WELD_HIT_RADIUS
    ) {
      const x = Math.floor(point.x);
      return { x1: x, y1: horizontalLine - 1, x2: x, y2: horizontalLine };
    }
    return null;
  }

  setHover(
    cell: GridCell | null,
    kind: TileKind = TileKind.Empty,
    orientation: Direction = Direction.Up,
    mirrored = false,
  ): void {
    const x = cell?.x ?? -1;
    const y = cell?.y ?? -1;
    mirrored = mirroringForKind(kind, mirrored);
    if (
      this.hoverX !== x ||
      this.hoverY !== y ||
      this.hoverKind !== kind ||
      this.hoverOrientation !== orientation ||
      this.hoverMirrored !== mirrored ||
      this.hoverEdge !== null
    ) {
      this.renderInvalidated = true;
      this.hoverX = x;
      this.hoverY = y;
      this.hoverKind = kind;
      this.hoverOrientation = orientation;
      this.hoverMirrored = mirrored;
      this.hoverEdge = null;
    }
  }

  setHoverEdge(edge: GridEdge | null): void {
    const edgeChanged = this.hoverEdge?.x1 !== edge?.x1 ||
      this.hoverEdge?.y1 !== edge?.y1 ||
      this.hoverEdge?.x2 !== edge?.x2 ||
      this.hoverEdge?.y2 !== edge?.y2;
    if (edgeChanged || this.hoverX !== -1 || this.hoverY !== -1) {
      this.renderInvalidated = true;
      this.hoverEdge = edge;
      this.hoverX = -1;
      this.hoverY = -1;
    }
  }

  /** Highlights a signal source independently of the placement cursor. */
  setHighlightedTileId(tileId: number | null): void {
    if (this.highlightedTileId === tileId) {
      return;
    }
    this.highlightedTileId = tileId;
    this.highlightedTileIndex = -1;
    this.highlightedGeometryRevision = -1;
    this.renderInvalidated = true;
  }

  setFootprintBounds(bounds: GridRectangle | null): void {
    if (this.footprintBounds === bounds) {
      return;
    }
    this.footprintBounds = bounds;
    this.renderInvalidated = true;
  }

  private drawFootprint(): void {
    const bounds = this.footprintBounds;
    if (bounds === null) {
      return;
    }
    const { context, cellSize } = this;
    const x = this.originX + bounds.x * cellSize;
    const y = this.originY + bounds.y * cellSize;
    const width = bounds.width * cellSize;
    const height = bounds.height * cellSize;
    context.save();
    context.beginPath();
    context.rect(this.originX, this.originY, this.world.width * cellSize, this.world.height * cellSize);
    context.clip();
    context.fillStyle = "rgb(220 220 120 / 10%)";
    context.strokeStyle = "#e2b357";
    context.lineWidth = 2;
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
    context.restore();
  }

  private resizeBackingStore(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const sizeChanged = width !== this.viewportWidth || height !== this.viewportHeight;
    const devicePixelRatio = window.devicePixelRatio || 1;
    const backingWidth = Math.round(width * devicePixelRatio);
    const backingHeight = Math.round(height * devicePixelRatio);
    const backingSizeChanged =
      this.canvas.width !== backingWidth || this.canvas.height !== backingHeight;

    if (backingSizeChanged) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
    }

    this.context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.context.imageSmoothingEnabled = false;
    this.viewportWidth = width;
    this.viewportHeight = height;

    if (!this.viewInitialized || (sizeChanged && !this.viewModified)) {
      this.fitViewToViewport();
      this.viewInitialized = true;
    } else if (sizeChanged) {
      this.updateOrigin();
    }
    if (sizeChanged || backingSizeChanged) {
      this.renderInvalidated = true;
    }
  }

  private fitViewToViewport(): void {
    this.cellSize = Math.min(
      this.viewportWidth / (this.world.width + this.fitMargin * 2),
      this.viewportHeight / (this.world.height + this.fitMargin * 2),
      MAX_TILE_SIZE,
    );
    this.viewCenterX = this.world.width / 2;
    this.viewCenterY = this.world.height / 2;
    this.updateOrigin();
  }

  private updateOrigin(): void {
    this.viewCenterX = Math.max(
      0,
      Math.min(this.world.width - GRID_EDGE_EPSILON, this.viewCenterX),
    );
    this.viewCenterY = Math.max(
      0,
      Math.min(this.world.height - GRID_EDGE_EPSILON, this.viewCenterY),
    );
    this.originX = this.viewportWidth / 2 - this.viewCenterX * this.cellSize;
    this.originY = this.viewportHeight / 2 - this.viewCenterY * this.cellSize;
  }

  private drawGrid(): void {
    const boardWidth = this.world.width * this.cellSize;
    const boardHeight = this.world.height * this.cellSize;
    const { context } = this;

    context.fillStyle = this.lightMode ? "#f4eddf" : "#191309";
    context.fillRect(this.originX, this.originY, boardWidth, boardHeight);
    context.strokeStyle = this.lightMode ? "#dbceb7" : "#2b2213";
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

    context.strokeStyle = this.nestedView === null
      ? (this.lightMode ? "#917951" : "#4c3d24")
      : NESTED_FRAME_COLOR;
    context.strokeRect(this.originX + 0.5, this.originY + 0.5, boardWidth, boardHeight);
  }

  /**
   * Draws the four virtual conduits just outside a nested board's edge centers, colored by
   * the containing array's side charges, and marks the inner port cells they connect to.
   */
  private drawNestedPorts(animationTime: number): void {
    const view = this.nestedView;
    if (view === null) {
      return;
    }
    const { context, cellSize, world } = this;
    context.save();
    context.strokeStyle = PORT_CELL_COLOR;
    context.lineWidth = Math.max(1, Math.min(2, cellSize * 0.05));
    context.setLineDash(PORT_CELL_DASH_PATTERN);
    for (let value = Direction.Up; value <= Direction.Left; value += 1) {
      const side = value as Direction;
      const charge = view.portCharge(side);
      const portIndex = runeArrayPortCellIndex(world.width, world.height, side);
      const portX = portIndex % world.width;
      const portY = (portIndex - portX) / world.width;
      const conduitX = portX + directionX(side);
      const conduitY = portY + directionY(side);
      const inward = oppositeDirection(side);
      drawTile(
        context,
        this.originX + conduitX * cellSize,
        this.originY + conduitY * cellSize,
        cellSize,
        TileKind.Conduit,
        Direction.Up,
        animationTime,
        charge,
        (1 << inward) as WeldSide,
        setCircuitPortCharge(0, inward, charge),
      );
      context.strokeRect(
        this.originX + portX * cellSize + 2.5,
        this.originY + portY * cellSize + 2.5,
        cellSize - 5,
        cellSize - 5,
      );
    }
    context.restore();
  }

  private drawEditRejection(): void {
    if (this.rejectedRegionUntil === 0 && this.rejectedCells.size === 0) return;
    const now = performance.now();
    const { context, cellSize } = this;
    context.save();
    // Hold briefly, then fade; wall-clock feedback also animates while simulation is paused.
    if (this.rejectedRegionUntil > now) {
      this.hasTimeDependentVisuals = true;
      context.globalAlpha = Math.min(1, (this.rejectedRegionUntil - now) / 450);
      if (this.editableRegion !== null && this.editableRegion.boundaryEdges.length > 0) {
        this.strokeGridRegion(this.editableRegion, EDIT_REJECTION_DASH_PATTERN, "#e15a4f");
      } else {
        // Fixed nested arrays have no editable boundary; flash their enclosing board instead.
        context.strokeStyle = "#e15a4f";
        context.lineWidth = 3;
        context.strokeRect(
          this.originX, this.originY, this.world.width * cellSize, this.world.height * cellSize,
        );
      }
    } else {
      this.rejectedRegionUntil = 0;
    }
    context.fillStyle = "#e15a4f";
    for (const [index, expiresAt] of this.rejectedCells) {
      if (expiresAt <= now) {
        this.rejectedCells.delete(index);
        continue;
      }
      this.hasTimeDependentVisuals = true;
      context.globalAlpha = 0.3 * Math.min(1, (expiresAt - now) / 450);
      context.fillRect(
        this.originX + (index % this.world.width) * cellSize,
        this.originY + Math.floor(index / this.world.width) * cellSize,
        cellSize,
        cellSize,
      );
    }
    context.restore();
  }

  private drawEditableRegion(): void {
    if (this.editableRegion !== null) {
      this.strokeGridRegion(this.editableRegion, EDITABLE_REGION_DASH_PATTERN, "#d6ad61");
    }
  }

  private drawEditableRegionAuthoring(): void {
    if (this.authoredEditableRegion === null) {
      return;
    }

    const { context } = this;
    context.save();
    context.fillStyle = "rgb(214 173 97 / 10%)";
    for (const rectangle of this.authoredEditableRegion.rectangles) {
      context.fillRect(
        this.originX + rectangle.x * this.cellSize,
        this.originY + rectangle.y * this.cellSize,
        rectangle.width * this.cellSize,
        rectangle.height * this.cellSize,
      );
    }
    context.restore();
    this.strokeGridRegion(
      this.authoredEditableRegion,
      EDITABLE_REGION_DASH_PATTERN,
      "#d6ad61",
    );

    const draft = this.authoredEditableRegionDraft;
    if (draft === null) {
      return;
    }
    context.save();
    context.fillStyle = "rgb(120 220 202 / 16%)";
    context.strokeStyle = "#78dcca";
    context.lineWidth = Math.max(1.5, Math.min(3, this.cellSize * 0.08));
    context.fillRect(
      this.originX + draft.x * this.cellSize,
      this.originY + draft.y * this.cellSize,
      draft.width * this.cellSize,
      draft.height * this.cellSize,
    );
    context.strokeRect(
      this.originX + draft.x * this.cellSize + 0.5,
      this.originY + draft.y * this.cellSize + 0.5,
      draft.width * this.cellSize,
      draft.height * this.cellSize,
    );
    context.restore();
  }

  private strokeGridRegion(
    region: GridRegion,
    dashPattern: readonly number[],
    color: string,
  ): void {
    const { context } = this;
    context.save();
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.5, Math.min(3, this.cellSize * 0.08));
    context.lineCap = "round";
    context.setLineDash(dashPattern);
    context.beginPath();
    for (const edge of region.boundaryEdges) {
      context.moveTo(
        this.originX + edge.x1 * this.cellSize + 0.5,
        this.originY + edge.y1 * this.cellSize + 0.5,
      );
      context.lineTo(
        this.originX + edge.x2 * this.cellSize + 0.5,
        this.originY + edge.y2 * this.cellSize + 0.5,
      );
    }
    context.stroke();
    context.restore();
  }
  private drawTileSelection(animationTime: number): void {
    const draft = this.tileSelectionDraft;
    const overlay = this.tileSelectionOverlay;
    if (draft === null && overlay === null) {
      return;
    }

    const { context } = this;
    if (overlay?.sourceRegion !== null && overlay?.sourceRegion !== undefined) {
      context.save();
      context.fillStyle = "rgb(7 5 3 / 68%)";
      for (const rectangle of overlay.sourceRegion.rectangles) {
        context.fillRect(
          this.originX + rectangle.x * this.cellSize,
          this.originY + rectangle.y * this.cellSize,
          rectangle.width * this.cellSize,
          rectangle.height * this.cellSize,
        );
      }
      context.restore();
    }

    if (overlay !== null) {
      context.save();
      context.globalAlpha = 0.88;
      this.rebuildSelectionBodyCache();
      context.translate(this.originX, this.originY);
      for (const body of this.cachedSelectionBodies) {
        drawBody(
          context,
          0,
          0,
          this.cellSize,
          body.cells,
          body.cells.length,
          body.path,
          animationTime,
        );
      }
      context.restore();
      context.save();
      context.globalAlpha = 0.88;
      context.fillStyle = overlay.valid ? "rgb(120 220 202 / 10%)" : "rgb(225 90 79 / 16%)";
      for (const rectangle of overlay.region.rectangles) {
        context.fillRect(
          this.originX + rectangle.x * this.cellSize,
          this.originY + rectangle.y * this.cellSize,
          rectangle.width * this.cellSize,
          rectangle.height * this.cellSize,
        );
      }
      context.restore();
      this.strokeGridRegion(
        overlay.region,
        [],
        overlay.valid ? "#78dcca" : "#e15a4f",
      );
    }

    if (draft !== null) {
      context.save();
      context.fillStyle = "rgb(120 220 202 / 16%)";
      for (const rectangle of draft.rectangles) {
        context.fillRect(
          this.originX + rectangle.x * this.cellSize,
          this.originY + rectangle.y * this.cellSize,
          rectangle.width * this.cellSize,
          rectangle.height * this.cellSize,
        );
      }
      context.restore();
      this.strokeGridRegion(draft, [], "#78dcca");
    }
  }

  private rebuildSelectionBodyCache(): void {
    const overlay = this.tileSelectionOverlay;
    if (
      this.cachedSelectionOverlay === overlay &&
      this.cachedSelectionCellSize === this.cellSize
    ) {
      return;
    }
    this.cachedSelectionOverlay = overlay;
    this.cachedSelectionCellSize = this.cellSize;
    this.cachedSelectionBodies.length = 0;
    if (overlay === null) {
      return;
    }

    const cellCount = this.world.cellCount;
    if (this.selectionBodyStamps.length !== cellCount) {
      this.selectionBodyStamps = new Int32Array(cellCount);
      this.selectionBodyStack = new Int32Array(cellCount);
      this.selectionCellIndices = new Int32Array(cellCount);
    } else {
      this.selectionBodyStamps.fill(0);
      this.selectionCellIndices.fill(0);
    }
    for (let previewIndex = 0; previewIndex < overlay.previewCells.length; previewIndex += 1) {
      const cell = expectDefined(overlay.previewCells[previewIndex], "selection preview cell");
      this.selectionCellIndices[cell.y * this.world.width + cell.x] = previewIndex + 1;
    }
    for (const cell of overlay.previewCells) {
      const index = cell.y * this.world.width + cell.x;
      if (this.selectionBodyStamps[index] !== 0) {
        continue;
      }
      const count = this.collectSelectionBody(index, overlay);
      const cells = new Array<BodyCell>(count);
      for (let cellIndex = 0; cellIndex < count; cellIndex += 1) {
        const bodyCell = expectDefined(
          this.selectionBodyCells[cellIndex],
          "cached selection body cell",
        );
        cells[cellIndex] = { ...bodyCell };
      }
      this.cachedSelectionBodies.push({
        cells,
        path: createBodyPath(0, 0, this.cellSize, cells, count),
      });
    }
  }

  private collectSelectionBody(startIndex: number, overlay: TileSelectionOverlay): number {
    const width = this.world.width;
    const stamp = startIndex + 1;
    let stackSize = 0;
    let count = 0;
    this.selectionBodyStamps[startIndex] = stamp;
    this.selectionBodyStack[stackSize] = startIndex;
    stackSize += 1;

    while (stackSize > 0) {
      stackSize -= 1;
      const index = expectDefined(
        this.selectionBodyStack[stackSize],
        "selection body stack entry",
      );
      const preview = this.selectionPreviewCellAtIndex(
        index,
        overlay,
        "indexed selection preview cell",
      );
      if (preview === null) {
        throw new Error("Selection body contains an empty preview position");
      }
      let cell = this.selectionBodyCells[count];
      if (cell === undefined) {
        cell = createBodyCell();
        this.selectionBodyCells.push(cell);
      }
      count += 1;
      cell.x = preview.x;
      cell.y = preview.y;
      cell.kind = preview.kind;
      cell.orientation = preview.orientation;
      cell.mirrored = mirroringForKind(preview.kind, preview.mirrored ?? false);
      cell.outputCharge = 0;
      cell.circuitConnections = WeldSide.None;
      cell.circuitPortCharges = 0;
      cell.componentState = preview.componentState;
      cell.nestedWorld = preview.componentState?.type === "array"
        ? preview.componentState.world
        : null;
      cell.seamRight = false;
      cell.seamDown = false;

      const x = preview.x;
      if (preview.weldRight) {
        stackSize = this.pushSelectionBodyCell(index + 1, stamp, stackSize);
      }
      const leftPreview = x > 0
        ? this.selectionPreviewCellAtIndex(
          index - 1,
          overlay,
          "left selection preview cell",
        )
        : null;
      if (leftPreview?.weldRight === true) {
        stackSize = this.pushSelectionBodyCell(index - 1, stamp, stackSize);
      }
      if (preview.weldDown) {
        stackSize = this.pushSelectionBodyCell(index + width, stamp, stackSize);
      }
      const upperPreview = index >= width
        ? this.selectionPreviewCellAtIndex(
          index - width,
          overlay,
          "upper selection preview cell",
        )
        : null;
      if (upperPreview?.weldDown === true) {
        stackSize = this.pushSelectionBodyCell(index - width, stamp, stackSize);
      }
    }

    for (let i = 0; i < count; i += 1) {
      const cell = expectDefined(this.selectionBodyCells[i], "collected selection body cell");
      const index = cell.y * width + cell.x;
      const preview = this.selectionPreviewCellAtIndex(
        index,
        overlay,
        "collected selection preview cell",
      );
      if (preview === null) {
        throw new Error("Collected selection body cell has no preview");
      }
      cell.seamRight = cell.x < this.world.width - 1 &&
        this.selectionBodyStamps[index + 1] === stamp &&
        !preview.weldRight;
      cell.seamDown = cell.y < this.world.height - 1 &&
        this.selectionBodyStamps[index + width] === stamp &&
        !preview.weldDown;
    }
    return count;
  }

  private selectionPreviewCellAtIndex(
    index: number,
    overlay: TileSelectionOverlay,
    description: string,
  ): TileSelectionOverlay["previewCells"][number] | null {
    if (index < 0 || index >= this.selectionCellIndices.length) {
      throw new RangeError(`Selection preview index ${index} is outside the board`);
    }
    const storedIndex = expectDefined(this.selectionCellIndices[index], description);
    return storedIndex === 0
      ? null
      : expectDefined(overlay.previewCells[storedIndex - 1], description);
  }

  private pushSelectionBodyCell(index: number, stamp: number, stackSize: number): number {
    if (index < 0 || index >= this.selectionCellIndices.length) {
      throw new RangeError(`Selection weld index ${index} is outside the board`);
    }
    if (expectDefined(this.selectionCellIndices[index], "selection weld cell index") === 0) {
      throw new Error("Selection weld is missing its neighboring preview cell");
    }
    if (this.selectionBodyStamps[index] !== stamp) {
      this.selectionBodyStamps[index] = stamp;
      this.selectionBodyStack[stackSize] = index;
      return stackSize + 1;
    }
    return stackSize;
  }


  private drawTiles(previousWorld: World | null, progress: number, animationTime: number): void {
    this.translationInterpolation.prepare(this.world, previousWorld);
    this.rotationInterpolation.prepare(this.world, previousWorld, progress);
    if (
      previousWorld !== this.renderedPreviousWorld ||
      (previousWorld?.revision ?? -1) !== this.renderedPreviousWorldRevision
    ) {
      this.previousRotatorDirections.clear();
      if (previousWorld !== null) {
        for (
          let index = previousWorld.firstFeatureIndex(WorldFeature.Rotator);
          index >= 0;
          index = previousWorld.nextFeatureIndex(WorldFeature.Rotator, index)
        ) {
          this.previousRotatorDirections.set(
            previousWorld.idAtIndex(index),
            previousWorld.rotatorDirectionAtIndex(index),
          );
        }
      }
    }
    if (this.cellSize < LOW_DETAIL_CELL_SIZE) {
      this.drawLowDetailTiles(previousWorld, progress);
      return;
    }

    this.rebuildBodyCache();
    const animated = previousWorld !== null && progress < 1;
    for (const body of this.cachedBodies) {
      if (body === null) continue;
      if (!animated) {
        this.drawAnimatedBody(body, 1, animationTime);
      } else {
        const groups = this.movingBodies(body);
        if (groups.length === 1) {
          this.drawAnimatedBody(body, progress, animationTime);
        } else {
          // At the collapsed endpoint head and housing overlap. All slab fills
          // must precede the artwork so a later housing cannot erase its head.
          for (const movingBody of groups) {
            this.drawAnimatedBody(movingBody, progress, animationTime, "slab");
          }
          for (const movingBody of groups) {
            this.drawAnimatedBody(movingBody, progress, animationTime, "decoration");
          }
        }
      }
    }
  }

  /** Deforming assemblies split only where their rigid motion transforms differ. */
  private movingBodies(body: CachedBody): readonly CachedBody[] {
    const motion = this.translationInterpolation;
    const cached = this.motionBodies.get(body);
    if (cached?.revision === motion.revision &&
      cached.rotationRevision === this.rotationInterpolation.revision) return cached.bodies;
    const firstCell = expectDefined(body.cells[0], "first motion group cell");
    const firstKey = this.motionGroupAt(firstCell.y * this.world.width + firstCell.x);
    let uniform = true;
    for (let i = 1; i < body.cells.length; i += 1) {
      const cell = expectDefined(body.cells[i], "motion group cell");
      if (this.motionGroupAt(cell.y * this.world.width + cell.x) !== firstKey) {
        uniform = false;
        break;
      }
    }
    if (uniform && cached?.bodies.length === 1 && cached.bodies[0] === body) {
      cached.revision = motion.revision;
      cached.rotationRevision = this.rotationInterpolation.revision;
      return cached.bodies;
    }
    const bodies: CachedBody[] = [];
    if (uniform) {
      bodies.push(body);
    } else {
      const groups = new Map<number, BodyCell[]>();
      for (const cell of body.cells) {
        const key = this.motionGroupAt(cell.y * this.world.width + cell.x);
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [cell]);
        else group.push(cell);
      }
      for (const cells of groups.values()) {
        let minX = this.world.width;
        let minY = this.world.height;
        let maxX = 0;
        let maxY = 0;
        for (const cell of cells) {
          minX = Math.min(minX, cell.x);
          minY = Math.min(minY, cell.y);
          maxX = Math.max(maxX, cell.x + 1);
          maxY = Math.max(maxY, cell.y + 1);
        }
        bodies.push({
          cells,
          path: createBodyPath(0, 0, this.cellSize, cells, cells.length),
          minX, minY, maxX, maxY,
        });
      }
    }
    if (cached === undefined) {
      this.motionBodies.set(body, {
        revision: motion.revision, rotationRevision: this.rotationInterpolation.revision, bodies,
      });
    } else {
      cached.revision = motion.revision;
      cached.rotationRevision = this.rotationInterpolation.revision;
      cached.bodies = bodies;
    }
    return bodies;
  }

  private motionGroupAt(index: number): number {
    const rotationGroup = this.rotationInterpolation.groupAt(index);
    if (rotationGroup > 0) return -rotationGroup;
    const motion = this.translationInterpolation;
    return (motion.yAt(index) + this.world.height) * (this.world.width * 2 + 1) +
      motion.xAt(index) + this.world.width;
  }

  private drawAnimatedBody(
    body: CachedBody,
    progress: number,
    animationTime: number,
    phase: "all" | "slab" | "decoration" = "all",
  ): void {
    const firstCell = expectDefined(body.cells[0], "first animated body cell");
    const firstIndex = firstCell.y * this.world.width + firstCell.x;
    const rotation = this.rotationInterpolation.at(firstIndex);
    const remainingProgress = 1 - progress;
    const motion = this.translationInterpolation;
    const offsetX = rotation === null ? motion.xAt(firstIndex) * remainingProgress : 0;
    const offsetY = rotation === null ? motion.yAt(firstIndex) * remainingProgress : 0;
    let minX = body.minX + offsetX;
    let minY = body.minY + offsetY;
    let maxX = body.maxX + offsetX;
    let maxY = body.maxY + offsetY;
    if (rotation !== null) {
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const halfWidth = (maxX - minX) / 2;
      const halfHeight = (maxY - minY) / 2;
      const rotatedX = rotation.cosine * centerX - rotation.sine * centerY + rotation.x;
      const rotatedY = rotation.sine * centerX + rotation.cosine * centerY + rotation.y;
      const extentX = Math.abs(rotation.cosine) * halfWidth + Math.abs(rotation.sine) * halfHeight;
      const extentY = Math.abs(rotation.sine) * halfWidth + Math.abs(rotation.cosine) * halfHeight;
      minX = rotatedX - extentX;
      maxX = rotatedX + extentX;
      minY = rotatedY - extentY;
      maxY = rotatedY + extentY;
    }
    const visibleLeft = -this.originX / this.cellSize - 1;
    const visibleTop = -this.originY / this.cellSize - 1;
    const visibleRight = (this.viewportWidth - this.originX) / this.cellSize + 1;
    const visibleBottom = (this.viewportHeight - this.originY) / this.cellSize + 1;
    if (maxX <= visibleLeft || minX >= visibleRight ||
      maxY <= visibleTop || minY >= visibleBottom) return;

    for (const cell of body.cells) {
      if (
        (cell.kind === TileKind.Conveyor && cell.outputCharge !== 0) ||
        ((cell.kind === TileKind.Furnace || cell.kind === TileKind.Grinder ||
          cell.kind === TileKind.Drill) && cell.outputCharge === 1)
      ) {
        this.hasTimeDependentVisuals = true;
      }
      const index = cell.y * this.world.width + cell.x;
      cell.pistonTransition = remainingProgress > 0 ? motion.transitionAt(index) : 0;
      cell.pistonTransitionProgress = progress;
      cell.rotatorTurnOffset = 0;
      if (remainingProgress > 0 && cell.componentState?.type === "rotator") {
        const previousDirection = this.previousRotatorDirections.get(this.world.idAtIndex(index));
        if (previousDirection !== undefined) {
          const direction = cell.componentState.direction;
          const bodyTurn = rotation?.quarterTurn ?? 0;
          let turn = ((direction - previousDirection - bodyTurn + 6) % 4) - 2;
          // Batched opposite-side grips pass through the front, never the rear input.
          if (turn === -2 && previousDirection === ((cell.orientation + 3) & 3)) turn = 2;
          cell.rotatorTurnOffset = -turn * remainingProgress;
        }
      }
    }
    this.context.save();
    this.context.translate(
      this.originX + offsetX * this.cellSize,
      this.originY + offsetY * this.cellSize,
    );
    if (rotation !== null) this.applyRotationTransform(rotation);
    drawBody(
      this.context, 0, 0, this.cellSize, body.cells, body.cells.length,
      body.path, animationTime, phase,
    );
    this.context.restore();
  }

  private drawLowDetailTiles(previousWorld: World | null, progress: number): void {
    const { cellSize, originX, originY, world } = this;
    const remainingProgress = previousWorld === null ? 0 : 1 - progress;
    const startX = Math.max(0, Math.floor(-originX / cellSize) - 1);
    const startY = Math.max(0, Math.floor(-originY / cellSize) - 1);
    const endX = Math.min(world.width, Math.ceil((this.viewportWidth - originX) / cellSize) + 1);
    const endY = Math.min(world.height, Math.ceil((this.viewportHeight - originY) / cellSize) + 1);
    this.lowDetailPaths.fill(undefined);

    for (let y = startY; y < endY; y += 1) {
      let index = y * world.width + startX;
      for (let x = startX; x < endX; x += 1, index += 1) {
        this.appendLowDetailCell(index, remainingProgress);
      }
    }
    if (remainingProgress > 0) {
      // A destination outside the viewport can still be passing through it this frame.
      for (const index of this.translationInterpolation.movingIndices) {
        const x = index % world.width;
        const y = Math.floor(index / world.width);
        if (x < startX || x >= endX || y < startY || y >= endY) {
          this.appendLowDetailCell(index, remainingProgress);
        }
      }
    }
    for (let kind = 0; kind < this.lowDetailPaths.length; kind += 1) {
      const path = this.lowDetailPaths[kind];
      if (path === undefined) continue;
      this.context.fillStyle = TILE_DEFINITIONS[kind as TileKind].fill;
      this.context.fill(path);
    }
    if (this.rotationInterpolation.active) {
      for (const index of this.rotationInterpolation.indices) {
        const rotation = this.rotationInterpolation.at(index);
        if (rotation === null) throw new Error(`Missing rotation for animated cell ${index}`);
        const orientation = world.orientationAtIndex(index);
        const headOffset = this.translationInterpolation.transitionAt(index) === -1 ? remainingProgress : 0;
        this.context.save();
        this.context.translate(originX, originY);
        this.applyRotationTransform(rotation);
        this.context.fillStyle = TILE_DEFINITIONS[world.kindAtIndex(index)].fill;
        this.context.fillRect(
          (index % world.width + directionX(orientation) * headOffset) * cellSize,
          (Math.floor(index / world.width) + directionY(orientation) * headOffset) * cellSize,
          cellSize, cellSize,
        );
        this.context.restore();
      }
    }
  }

  private appendLowDetailCell(index: number, remainingProgress: number): void {
    const kind = this.world.kindAtIndex(index);
    if (kind === TileKind.Empty || this.rotationInterpolation.at(index) !== null) return;
    const motion = this.translationInterpolation;
    let dx = motion.xAt(index);
    let dy = motion.yAt(index);
    if (motion.transitionAt(index) === -1) {
      const orientation = this.world.orientationAtIndex(index);
      dx += directionX(orientation);
      dy += directionY(orientation);
    }
    const left = this.originX + (index % this.world.width + dx * remainingProgress) * this.cellSize;
    const top = this.originY +
      (Math.floor(index / this.world.width) + dy * remainingProgress) * this.cellSize;
    if (left + this.cellSize < 0 || left > this.viewportWidth ||
      top + this.cellSize < 0 || top > this.viewportHeight) return;
    let path = this.lowDetailPaths[kind];
    if (path === undefined) {
      path = new Path2D();
      this.lowDetailPaths[kind] = path;
    }
    path.rect(left, top, this.cellSize, this.cellSize);
  }

  private applyRotationTransform(rotation: RotationTransform): void {
    this.context.transform(
      rotation.cosine, rotation.sine, -rotation.sine, rotation.cosine,
      rotation.x * this.cellSize, rotation.y * this.cellSize,
    );
  }

  private rebuildBodyCache(): void {
    const geometryChanged =
      this.cachedWorldGeometryRevision !== this.world.geometryRevision ||
      this.cachedCellSize !== this.cellSize;
    if (geometryChanged) {
      if (
        this.cachedCellSize !== this.cellSize ||
        this.bodyIndexByCell.length !== this.world.cellCount
      ) {
        this.rebuildCompleteBodyCache();
      } else {
        this.rebuildChangedBodyGeometry();
      }
      this.cachedWorldGeometryRevision = this.world.geometryRevision;
      this.cachedCellSize = this.cellSize;
    }

    if (this.cachedWorldRevision !== this.world.revision) {
      this.refreshCachedBodyState();
      this.cachedWorldRevision = this.world.revision;
    }
  }

  private rebuildCompleteBodyCache(): void {
    const cellCount = this.world.cellCount;
    if (this.bodyStamps.length !== cellCount) {
      this.bodyStamps = new Int32Array(cellCount);
      this.bodyStack = new Int32Array(cellCount);
      this.bodyIndexByCell = new Int32Array(cellCount);
      this.cachedKinds = new Uint8Array(cellCount);
      this.cachedRightWelds = new Uint8Array(cellCount);
      this.cachedDownWelds = new Uint8Array(cellCount);
      this.dirtyCellIndices = new Int32Array(cellCount);
    } else {
      this.bodyStamps.fill(0);
      this.bodyIndexByCell.fill(0);
    }
    this.cachedBodies.length = 0;
    this.freeCachedBodyIndices.length = 0;

    for (let index = 0; index < cellCount; index += 1) {
      this.snapshotCellGeometry(index);
      if (this.world.kindAtIndex(index) !== TileKind.Empty && this.bodyIndexByCell[index] === 0) {
        this.cacheBody(index);
      }
    }
  }

  private rebuildChangedBodyGeometry(): void {
    let dirtyCellCount = 0;
    for (let index = 0; index < this.world.cellCount; index += 1) {
      const kind = this.world.kindAtIndex(index);
      const rightWeld = this.world.hasRightWeldAtIndex(index) ? 1 : 0;
      const downWeld = this.world.hasDownWeldAtIndex(index) ? 1 : 0;
      if (
        this.cachedKinds[index] === kind &&
        this.cachedRightWelds[index] === rightWeld &&
        this.cachedDownWelds[index] === downWeld
      ) {
        continue;
      }
      this.cachedKinds[index] = kind;
      this.cachedRightWelds[index] = rightWeld;
      this.cachedDownWelds[index] = downWeld;
      this.dirtyCellIndices[dirtyCellCount] = index;
      dirtyCellCount += 1;
    }

    for (let dirtyIndex = 0; dirtyIndex < dirtyCellCount; dirtyIndex += 1) {
      const index = expectDefined(this.dirtyCellIndices[dirtyIndex], "dirty body cell index");
      this.invalidateBodyNeighborhood(index);
    }
    for (let dirtyIndex = 0; dirtyIndex < dirtyCellCount; dirtyIndex += 1) {
      const index = expectDefined(this.dirtyCellIndices[dirtyIndex], "dirty body cell index");
      this.rebuildBodyNeighborhood(index);
    }
  }

  private snapshotCellGeometry(index: number): void {
    this.cachedKinds[index] = this.world.kindAtIndex(index);
    this.cachedRightWelds[index] = this.world.hasRightWeldAtIndex(index) ? 1 : 0;
    this.cachedDownWelds[index] = this.world.hasDownWeldAtIndex(index) ? 1 : 0;
  }

  private invalidateBodyNeighborhood(index: number): void {
    const x = index % this.world.width;
    this.invalidateCachedBodyAt(index);
    if (x > 0) {
      this.invalidateCachedBodyAt(index - 1);
    }
    if (x + 1 < this.world.width) {
      this.invalidateCachedBodyAt(index + 1);
    }
    if (index >= this.world.width) {
      this.invalidateCachedBodyAt(index - this.world.width);
    }
    if (index + this.world.width < this.world.cellCount) {
      this.invalidateCachedBodyAt(index + this.world.width);
    }
  }

  private invalidateCachedBodyAt(index: number): void {
    const storedBodyIndex = expectDefined(this.bodyIndexByCell[index], "cached body index");
    if (storedBodyIndex === 0) {
      return;
    }
    const bodyIndex = storedBodyIndex - 1;
    const body = this.cachedBodies[bodyIndex];
    if (body === null || body === undefined) {
      throw new Error("Cached body cell points to a missing body");
    }
    this.cachedBodies[bodyIndex] = null;
    this.freeCachedBodyIndices.push(bodyIndex);
    for (const cell of body.cells) {
      const cellIndex = cell.y * this.world.width + cell.x;
      this.bodyIndexByCell[cellIndex] = 0;
      this.bodyStamps[cellIndex] = 0;
    }
  }

  private rebuildBodyNeighborhood(index: number): void {
    const x = index % this.world.width;
    this.cacheBodyIfNeeded(index);
    if (x > 0) {
      this.cacheBodyIfNeeded(index - 1);
    }
    if (x + 1 < this.world.width) {
      this.cacheBodyIfNeeded(index + 1);
    }
    if (index >= this.world.width) {
      this.cacheBodyIfNeeded(index - this.world.width);
    }
    if (index + this.world.width < this.world.cellCount) {
      this.cacheBodyIfNeeded(index + this.world.width);
    }
  }

  private cacheBodyIfNeeded(index: number): void {
    if (
      this.world.kindAtIndex(index) !== TileKind.Empty &&
      this.bodyIndexByCell[index] === 0
    ) {
      this.cacheBody(index);
    }
  }

  private cacheBody(startIndex: number): void {
    const count = this.collectBody(startIndex);
    const cells = new Array<BodyCell>(count);
    let minX = this.world.width;
    let minY = this.world.height;
    let maxX = 0;
    let maxY = 0;
    for (let cellIndex = 0; cellIndex < count; cellIndex += 1) {
      const cell = expectDefined(this.bodyCells[cellIndex], "cached body cell");
      const worldIndex = cell.y * this.world.width + cell.x;
      if (this.bodyIndexByCell[worldIndex] !== 0) {
        throw new Error("New body geometry overlaps an unchanged cached body");
      }
      cells[cellIndex] = { ...cell };
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x + 1);
      maxY = Math.max(maxY, cell.y + 1);
    }

    const freeBodyIndex = this.freeCachedBodyIndices.pop();
    const bodyIndex = freeBodyIndex ?? this.cachedBodies.length;
    const body: CachedBody = {
      cells,
      path: createBodyPath(0, 0, this.cellSize, cells, count),
      minX,
      minY,
      maxX,
      maxY,
    };
    this.cachedBodies[bodyIndex] = body;
    for (const cell of cells) {
      this.bodyIndexByCell[cell.y * this.world.width + cell.x] = bodyIndex + 1;
    }
  }

  private refreshCachedBodyState(): void {
    for (const body of this.cachedBodies) {
      if (body === null) {
        continue;
      }
      for (const cell of body.cells) {
        const index = cell.y * this.world.width + cell.x;
        if (this.world.kindAtIndex(index) === TileKind.Empty) {
          throw new Error("World body geometry changed without incrementing its geometry revision");
        }
        populateBodyCell(this.world, index, cell);
      }
    }
  }

  /** Flood-fills the welded body containing `startIndex` into `bodyCells`; returns its size. */
  private collectBody(startIndex: number): number {
    const { world, bodyStamps, bodyStack } = this;
    const width = world.width;
    const stamp = startIndex + 1;
    let stackSize = 0;
    let count = 0;
    bodyStamps[startIndex] = stamp;
    bodyStack[stackSize] = startIndex;
    stackSize += 1;

    while (stackSize > 0) {
      stackSize -= 1;
      const index = expectDefined(bodyStack[stackSize], "welded body stack entry");
      let cell = this.bodyCells[count];
      if (cell === undefined) {
        cell = createBodyCell();
        this.bodyCells.push(cell);
      }
      count += 1;
      populateBodyCell(world, index, cell);
      const x = cell.x;

      if (world.hasRightWeldAtIndex(index) && bodyStamps[index + 1] !== stamp) {
        bodyStamps[index + 1] = stamp;
        bodyStack[stackSize] = index + 1;
        stackSize += 1;
      }
      if (x > 0 && world.hasRightWeldAtIndex(index - 1) && bodyStamps[index - 1] !== stamp) {
        bodyStamps[index - 1] = stamp;
        bodyStack[stackSize] = index - 1;
        stackSize += 1;
      }
      if (world.hasDownWeldAtIndex(index) && bodyStamps[index + width] !== stamp) {
        bodyStamps[index + width] = stamp;
        bodyStack[stackSize] = index + width;
        stackSize += 1;
      }
      if (index >= width && world.hasDownWeldAtIndex(index - width) && bodyStamps[index - width] !== stamp) {
        bodyStamps[index - width] = stamp;
        bodyStack[stackSize] = index - width;
        stackSize += 1;
      }
    }

    for (let i = 0; i < count; i += 1) {
      const cell = expectDefined(this.bodyCells[i], "collected body cell");
      const index = cell.y * width + cell.x;
      cell.seamRight = cell.x < width - 1 &&
        bodyStamps[index + 1] === stamp &&
        !world.hasRightWeldAtIndex(index);
      cell.seamDown = cell.y < world.height - 1 &&
        bodyStamps[index + width] === stamp &&
        !world.hasDownWeldAtIndex(index);
    }

    return count;
  }


  private drawComponentOverlay(kind: TileKind, orientation: Direction, mirrored = false): void {
    switch (kind) {
      case TileKind.Welder:
      case TileKind.Splitter:
      case TileKind.LaserSplitter:
        this.drawWeldOperationPreview(kind, orientation, mirrored);
        break;
      case TileKind.Sensor:
      case TileKind.Magnet:
      case TileKind.Piston:
      case TileKind.PistonBase:
      case TileKind.Furnace:
      case TileKind.Grinder:
      case TileKind.Drill:
        this.drawSensorObservation(orientation);
        break;
      case TileKind.ChargeSensor:
        this.drawSensorObservation(orientation, true);
        break;
      case TileKind.ForceProjector:
        this.drawSensorObservation(orientation, true, false);
        break;
      case TileKind.LevitationProjector:
        this.drawLevitationBeam(orientation);
        break;
      case TileKind.Rotator:
        this.drawRotatorReach(orientation, mirrored);
        break;
    }
  }

  private drawLevitationBeam(orientation: Direction): void {
    const dx = directionX(orientation);
    const dy = directionY(orientation);
    const startX = this.hoverX + 0.5 + dx / 2;
    const startY = this.hoverY + 0.5 + dy / 2;
    let endX = dx === 0 ? startX : dx > 0 ? this.world.width : 0;
    let endY = dy === 0 ? startY : dy > 0 ? this.world.height : 0;
    const opposingDirection = oppositeDirection(orientation);
    for (
      let x = this.hoverX + dx, y = this.hoverY + dy;
      x >= 0 && x < this.world.width && y >= 0 && y < this.world.height;
      x += dx, y += dy
    ) {
      if (
        this.world.kindAt(x, y) === TileKind.LevitationProjector &&
        this.world.orientationAt(x, y) === opposingDirection
      ) {
        endX = x + 0.5 - dx / 2;
        endY = y + 0.5 - dy / 2;
        break;
      }
    }
    const { context, cellSize } = this;
    context.save();
    context.strokeStyle = "#bdeeff";
    context.globalAlpha = 0.18;
    context.lineWidth = cellSize * 0.8;
    context.beginPath();
    context.moveTo(this.originX + startX * cellSize, this.originY + startY * cellSize);
    context.lineTo(this.originX + endX * cellSize, this.originY + endY * cellSize);
    context.stroke();
    context.globalAlpha = 0.8;
    context.lineWidth = Math.max(1, cellSize * 0.035);
    context.stroke();
    context.restore();
  }

  private drawWeldOperationPreview(kind: TileKind, orientation: Direction, mirrored: boolean): void {
    const forwardX = directionX(orientation);
    const forwardY = directionY(orientation);
    const targetX = this.hoverX + forwardX;
    const targetY = this.hoverY + forwardY;
    if (
      targetX < 0 || targetX >= this.world.width ||
      targetY < 0 || targetY >= this.world.height
    ) {
      return;
    }

    const { context, cellSize } = this;
    context.save();
    context.strokeStyle = kind === TileKind.Welder ? "#78dcca" : "#e15a4f";
    context.lineWidth = Math.max(2, cellSize * 0.07);
    context.lineCap = "round";
    context.globalAlpha = 0.8;
    context.beginPath();
    if (kind === TileKind.LaserSplitter) {
      // The cutting edge follows local handedness, from the front neighbor to the boundary.
      const cuttingSide = orientedDirection(Direction.Left, orientation, mirrored);
      const sideX = directionX(cuttingSide);
      const sideY = directionY(cuttingSide);
      if (
        targetX + sideX >= 0 && targetX + sideX < this.world.width &&
        targetY + sideY >= 0 && targetY + sideY < this.world.height
      ) {
        const startX = targetX + 0.5 + sideX / 2 - forwardX / 2;
        const startY = targetY + 0.5 + sideY / 2 - forwardY / 2;
        const endX = forwardX === 0 ? startX : forwardX > 0 ? this.world.width : 0;
        const endY = forwardY === 0 ? startY : forwardY > 0 ? this.world.height : 0;
        context.moveTo(this.originX + startX * cellSize, this.originY + startY * cellSize);
        context.lineTo(this.originX + endX * cellSize, this.originY + endY * cellSize);
      }
      context.stroke();
      context.restore();
      return;
    }
    // The operator changes the two transverse edges of its forward neighbor.
    for (let side = -1; side <= 1; side += 2) {
      const neighborX = targetX - forwardY * side;
      const neighborY = targetY + forwardX * side;
      if (
        neighborX < 0 || neighborX >= this.world.width ||
        neighborY < 0 || neighborY >= this.world.height
      ) {
        continue;
      }
      const centerX = this.originX + (targetX + 0.5 - forwardY * side / 2) * cellSize;
      const centerY = this.originY + (targetY + 0.5 + forwardX * side / 2) * cellSize;
      context.moveTo(
        centerX - forwardX * cellSize * 0.38,
        centerY - forwardY * cellSize * 0.38,
      );
      context.lineTo(
        centerX + forwardX * cellSize * 0.38,
        centerY + forwardY * cellSize * 0.38,
      );
    }
    context.stroke();
    context.restore();
  }

  private drawSensorObservation(
    orientation: Direction,
    atDistance = false,
    skipInvisible = true,
  ): void {
    const dx = directionX(orientation);
    const dy = directionY(orientation);
    let x = this.hoverX + dx;
    let y = this.hoverY + dy;
    if (atDistance) {
      while (x >= 0 && x < this.world.width && y >= 0 && y < this.world.height) {
        const tileKind = this.world.kindAt(x, y);
        if (tileKind !== TileKind.Empty &&
            (!skipInvisible || !TILE_DEFINITIONS[tileKind].invisibleToSensor)) {
          break;
        }
        x += dx;
        y += dy;
      }
    }
    const hasTarget = x >= 0 && x < this.world.width && y >= 0 && y < this.world.height;
    if (!hasTarget && !atDistance) {
      return;
    }
    const { context, cellSize } = this;
    context.save();
    context.strokeStyle = "#78dcca";
    context.lineWidth = Math.max(2, cellSize * 0.04);
    context.globalAlpha = 0.8;
    context.beginPath();
    if (hasTarget) {
      context.arc(
        this.originX + (x + 0.5) * cellSize,
        this.originY + (y + 0.5) * cellSize,
        cellSize * 0.43,
        0,
        Math.PI * 2,
      );
    }
    if (atDistance) {
      // An out-of-bounds cell's near edge is exactly the board boundary.
      const targetInset = hasTarget ? 0.43 : 0.5;
      context.moveTo(
        this.originX + (this.hoverX + 0.5 + dx * 0.5) * cellSize,
        this.originY + (this.hoverY + 0.5 + dy * 0.5) * cellSize,
      );
      context.lineTo(
        this.originX + (x + 0.5 - dx * targetInset) * cellSize,
        this.originY + (y + 0.5 - dy * targetInset) * cellSize,
      );
    }
    context.stroke();
    context.restore();
  }

  private drawRotatorReach(orientation: Direction, mirrored: boolean): void {
    const { context, cellSize } = this;
    context.save();
    // Clip both cells and arrows to the board when the pivot is near a wall.
    context.beginPath();
    context.rect(this.originX, this.originY, this.world.width * cellSize, this.world.height * cellSize);
    context.clip();
    context.translate(
      this.originX + (this.hoverX + 0.5) * cellSize,
      this.originY + (this.hoverY + 0.5) * cellSize,
    );
    context.rotate(orientation * Math.PI / 2);
    context.scale(cellSize, cellSize);
    context.strokeStyle = "#78dcca";
    context.fillStyle = "rgb(120 220 202 / 12%)";
    context.lineWidth = 0.035;
    for (let side = -1; side <= 1; side += 1) {
      const x = side;
      const y = side === 0 ? -1 : 0;
      context.fillRect(x - 0.44, y - 0.44, 0.88, 0.88);
      context.strokeRect(x - 0.44, y - 0.44, 0.88, 0.88);
    }
    // Signed arcs show both commands; reflection swaps their physical turn directions.
    if (mirrored) context.scale(-1, 1);
    context.lineWidth = 0.045;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (let sign = -1; sign <= 1; sign += 2) {
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[sign as Charge];
      context.beginPath();
      context.arc(0, 0, 0.8, -Math.PI / 2, sign === 1 ? 0 : -Math.PI, sign === -1);
      context.moveTo(sign * 0.65, -0.15);
      context.lineTo(sign * 0.8, 0);
      context.lineTo(sign * 0.95, -0.15);
      context.stroke();
    }
    context.restore();
  }

  private drawHighlightedTile(previousWorld: World | null, progress: number): void {
    const tileId = this.highlightedTileId;
    if (tileId === null) {
      return;
    }
    const { world, context, cellSize } = this;
    if (this.highlightedGeometryRevision !== world.geometryRevision) {
      this.highlightedGeometryRevision = world.geometryRevision;
      if (
        this.highlightedTileIndex < 0 ||
        world.idAtIndex(this.highlightedTileIndex) !== tileId
      ) {
        this.highlightedTileIndex = -1;
        for (
          let index = world.firstFeatureIndex(WorldFeature.Occupied);
          index >= 0;
          index = world.nextFeatureIndex(WorldFeature.Occupied, index)
        ) {
          if (world.idAtIndex(index) === tileId) {
            this.highlightedTileIndex = index;
            break;
          }
        }
      }
    }
    if (this.highlightedTileIndex < 0) {
      return;
    }
    const x = this.highlightedTileIndex % world.width;
    const y = Math.floor(this.highlightedTileIndex / world.width);
    let offsetX = 0;
    let offsetY = 0;
    const rotation = this.rotationInterpolation.at(this.highlightedTileIndex);
    if (previousWorld !== null && progress < 1) {
      const motion = this.translationInterpolation;
      let dx = rotation === null ? motion.xAt(this.highlightedTileIndex) : 0;
      let dy = rotation === null ? motion.yAt(this.highlightedTileIndex) : 0;
      if (motion.transitionAt(this.highlightedTileIndex) === -1) {
        const orientation = world.orientationAtIndex(this.highlightedTileIndex);
        dx += directionX(orientation);
        dy += directionY(orientation);
      }
      offsetX = dx * cellSize * (1 - progress);
      offsetY = dy * cellSize * (1 - progress);
    }
    const left = x * cellSize + offsetX;
    const top = y * cellSize + offsetY;
    const inset = Math.min(3, cellSize * 0.15);
    context.save();
    context.translate(this.originX, this.originY);
    if (rotation !== null) this.applyRotationTransform(rotation);
    context.strokeStyle = "#f1cc38";
    context.lineWidth = 3;
    context.strokeRect(left, top, cellSize, cellSize);
    context.strokeStyle = "#78dcca";
    context.lineWidth = 1;
    context.strokeRect(left + inset, top + inset, cellSize - inset * 2, cellSize - inset * 2);
    context.restore();
  }

  private drawHover(animationTime: number): void {
    if (this.hoverEdge !== null) {
      const { x1, y1, x2, y2 } = this.hoverEdge;
      const editable = this.editableRegion === null ||
        this.editableRegion.containsEdge(x1, y1, x2, y2);
      this.context.strokeStyle = editable && this.world.canWeld(x1, y1, x2, y2)
        ? "#78dcca"
        : "#e15a4f";
      this.context.lineWidth = 3;
      this.context.beginPath();
      if (y1 === y2) {
        const lineX = this.originX + Math.max(x1, x2) * this.cellSize;
        this.context.moveTo(lineX, this.originY + y1 * this.cellSize + 2);
        this.context.lineTo(lineX, this.originY + (y1 + 1) * this.cellSize - 2);
      } else {
        const lineY = this.originY + Math.max(y1, y2) * this.cellSize;
        this.context.moveTo(this.originX + x1 * this.cellSize + 2, lineY);
        this.context.lineTo(this.originX + (x1 + 1) * this.cellSize - 2, lineY);
      }
      this.context.stroke();
      return;
    }

    if (this.hoverX < 0 || this.hoverY < 0) {
      return;
    }
    const editable = this.editableRegion === null ||
      this.editableRegion.contains(this.hoverX, this.hoverY);
    const placedKind = this.world.kindAt(this.hoverX, this.hoverY);
    this.drawComponentOverlay(placedKind, this.world.orientationAt(this.hoverX, this.hoverY),
      this.world.mirroredAt(this.hoverX, this.hoverY));

    if (
      editable &&
      this.hoverKind !== TileKind.Empty &&
      placedKind === TileKind.Empty
    ) {
      this.context.save();
      this.context.globalAlpha = 0.55;
      drawTile(
        this.context,
        this.originX + this.hoverX * this.cellSize,
        this.originY + this.hoverY * this.cellSize,
        this.cellSize,
        this.hoverKind,
        this.hoverOrientation,
        animationTime,
        0,
        WeldSide.None,
        0,
        this.hoverMirrored,
      );
      this.context.restore();
      this.drawComponentOverlay(this.hoverKind, this.hoverOrientation, this.hoverMirrored);
    }

    this.context.strokeStyle = editable ? "#78dcca" : "#e15a4f";
    this.context.lineWidth = 2;
    this.context.strokeRect(
      this.originX + this.hoverX * this.cellSize + 1,
      this.originY + this.hoverY * this.cellSize + 1,
      this.cellSize - 2,
      this.cellSize - 2,
    );
  }
}
