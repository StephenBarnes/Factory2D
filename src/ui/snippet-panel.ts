import { collectWorldBodies } from "../render/body-cells";
import { exceedsPanDragThreshold } from "../render/pointer-gesture";
import { drawBody } from "../render/tile-renderer";
import type { World } from "../simulation/world";

const THUMBNAIL_SUPERSAMPLING = 2;
const THUMBNAIL_PADDING = 6;
const MAX_THUMBNAIL_CELL_SIZE = 18;

/** Presentation model for one snippet card in the current workshop. */
export interface SnippetCardModel {
  readonly id: string;
  readonly name: string;
  readonly world: World;
  /** Workshop-specific notes such as components that will be dropped on placement. */
  readonly warnings: readonly string[];
  /** False when the snippet cannot be floated on the current board at all. */
  readonly placeable: boolean;
}

export interface SnippetPanelElements {
  readonly root: HTMLElement;
  readonly list: HTMLElement;
  readonly emptyMessage: HTMLElement;
}

export interface SnippetPlacementPointer {
  readonly clientX: number;
  readonly clientY: number;
}

export interface SnippetPanelCallbacks {
  /**
   * Floats the snippet on the board. A pointer means the snippet follows a
   * drag from the card; null means a plain activation that should place the
   * snippet at the visible board center. Returns whether the snippet floated.
   */
  readonly beginPlacement: (id: string, pointer: SnippetPlacementPointer | null) => boolean;
  readonly movePlacement: (pointer: SnippetPlacementPointer) => void;
  readonly finishPlacement: () => void;
  readonly rename: (id: string) => void;
  readonly remove: (id: string) => void;
  readonly exportSnippet: (id: string) => void;
}

interface CardGesture {
  readonly pointerId: number;
  readonly id: string;
  readonly card: HTMLElement;
  readonly originX: number;
  readonly originY: number;
  placing: boolean;
}

/** Renders saved snippets as thumbnail cards and drives drag-from-card placement. */
export class SnippetPanel {
  private cards: readonly SnippetCardModel[] = [];
  private gesture: CardGesture | null = null;
  private editable = true;

  constructor(
    private readonly elements: SnippetPanelElements,
    private readonly callbacks: SnippetPanelCallbacks,
  ) {
    const list = elements.list;
    list.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    list.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    list.addEventListener("pointerup", (event) => this.handlePointerFinish(event));
    list.addEventListener("lostpointercapture", (event) => this.handlePointerFinish(event));
    list.addEventListener("pointercancel", (event) => this.handlePointerFinish(event));
    list.addEventListener("click", (event) => this.handleClick(event));
  }

  get placing(): boolean {
    return this.gesture?.placing === true;
  }

  /** Rebuilds every card; `highlightId` briefly emphasizes a newly saved snippet. */
  render(cards: readonly SnippetCardModel[], highlightId: string | null = null): void {
    this.cancelPlacement();
    this.cards = cards;
    const list = this.elements.list;
    list.replaceChildren();
    this.elements.emptyMessage.hidden = cards.length !== 0;
    let highlighted: HTMLElement | null = null;
    for (const model of cards) {
      const card = createCard(model);
      if (model.id === highlightId) {
        card.classList.add("snippet-card-new");
        highlighted = card;
      }
      list.append(card);
    }
    this.applyEditability();
    this.redrawThumbnails();
    highlighted?.scrollIntoView({ block: "nearest" });
  }

  setEditable(editable: boolean): void {
    if (this.editable === editable) {
      return;
    }
    this.editable = editable;
    if (!editable) {
      this.cancelPlacement();
    }
    this.applyEditability();
  }

  /** Redraws every thumbnail at the current display density; hidden cards are skipped. */
  redrawThumbnails(): void {
    const modelsById = new Map(this.cards.map((model) => [model.id, model]));
    for (const canvas of this.elements.list.querySelectorAll<HTMLCanvasElement>(
      ".snippet-thumbnail",
    )) {
      const card = canvas.closest<HTMLElement>(".snippet-card");
      const model = card === null ? undefined : modelsById.get(card.dataset.snippetId ?? "");
      if (model === undefined) {
        throw new Error("Snippet thumbnail is missing its card model");
      }
      drawThumbnail(canvas, model.world);
    }
  }

  /** Ends any card drag; the floated snippet, if any, stays on the board. */
  cancelPlacement(): void {
    const gesture = this.gesture;
    if (gesture === null) {
      return;
    }
    this.gesture = null;
    gesture.card.classList.remove("dragging");
    if (gesture.card.hasPointerCapture(gesture.pointerId)) {
      gesture.card.releasePointerCapture(gesture.pointerId);
    }
    if (gesture.placing) {
      this.callbacks.finishPlacement();
    }
  }

  private handlePointerDown(event: PointerEvent): void {
    const body = eventTarget(event)?.closest<HTMLButtonElement>(".snippet-card-body") ?? null;
    const card = body?.closest<HTMLElement>(".snippet-card") ?? null;
    if (
      event.button !== 0 ||
      body === null ||
      card === null ||
      body.disabled ||
      !this.editable
    ) {
      return;
    }
    this.cancelPlacement();
    event.preventDefault();
    card.setPointerCapture(event.pointerId);
    this.gesture = {
      pointerId: event.pointerId,
      id: requireSnippetId(card),
      card,
      originX: event.clientX,
      originY: event.clientY,
      placing: false,
    };
  }

  private handlePointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (gesture === null || event.pointerId !== gesture.pointerId) {
      return;
    }
    if ((event.buttons & 1) === 0) {
      this.cancelPlacement();
      return;
    }
    if (!gesture.placing) {
      if (!exceedsPanDragThreshold(
        event.clientX - gesture.originX,
        event.clientY - gesture.originY,
      )) {
        return;
      }
      if (!this.callbacks.beginPlacement(gesture.id, event)) {
        this.cancelPlacement();
        return;
      }
      gesture.placing = true;
      gesture.card.classList.add("dragging");
      return;
    }
    this.callbacks.movePlacement(event);
  }

  private handlePointerFinish(event: PointerEvent): void {
    const gesture = this.gesture;
    if (gesture === null || event.pointerId !== gesture.pointerId) {
      return;
    }
    const activate = event.type === "pointerup" && !gesture.placing;
    this.cancelPlacement();
    if (activate) {
      this.callbacks.beginPlacement(gesture.id, null);
    }
  }

  private handleClick(event: MouseEvent): void {
    const target = eventTarget(event);
    const card = target?.closest<HTMLElement>(".snippet-card") ?? null;
    if (card === null) {
      return;
    }
    const id = requireSnippetId(card);
    const action = target?.closest<HTMLButtonElement>("[data-snippet-action]") ?? null;
    if (action !== null) {
      event.preventDefault();
      switch (action.dataset.snippetAction) {
        case "rename":
          this.callbacks.rename(id);
          return;
        case "export":
          this.callbacks.exportSnippet(id);
          return;
        case "delete":
          this.callbacks.remove(id);
          return;
        default:
          throw new Error(`Unknown snippet action ${action.dataset.snippetAction}`);
      }
    }
    // Pointer activations are handled by the pointer gesture; keyboard
    // activation of the card body arrives as a click without pointer detail.
    const body = target?.closest<HTMLButtonElement>(".snippet-card-body") ?? null;
    if (body !== null && event.detail === 0 && !body.disabled && this.editable) {
      this.callbacks.beginPlacement(id, null);
    }
  }

  private applyEditability(): void {
    this.elements.root.classList.toggle("locked", !this.editable);
    for (const body of this.elements.list.querySelectorAll<HTMLButtonElement>(
      ".snippet-card-body",
    )) {
      const card = body.closest<HTMLElement>(".snippet-card");
      body.disabled = !this.editable || card?.classList.contains("unplaceable") === true;
    }
  }
}

function createCard(model: SnippetCardModel): HTMLElement {
  const card = document.createElement("article");
  card.className = "snippet-card";
  card.classList.toggle("unplaceable", !model.placeable);
  card.dataset.snippetId = model.id;

  const size = `${model.world.width}×${model.world.height}`;
  const body = document.createElement("button");
  body.className = "snippet-card-body";
  body.type = "button";
  body.title = model.placeable
    ? "Drag onto the board, or click to place at the board center"
    : "This snippet cannot be placed on the current board";
  body.setAttribute("aria-label", `Place ${model.name} (${size})`);

  const thumbnail = document.createElement("canvas");
  thumbnail.className = "snippet-thumbnail";
  thumbnail.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "snippet-card-name";
  name.textContent = model.name;
  const dimensions = document.createElement("span");
  dimensions.className = "snippet-card-size";
  dimensions.textContent = size;
  const caption = document.createElement("span");
  caption.className = "snippet-card-caption";
  caption.append(name, dimensions);
  body.append(thumbnail, caption);
  card.append(body);

  if (model.warnings.length > 0) {
    const warning = document.createElement("p");
    warning.className = "snippet-warning";
    warning.textContent = model.warnings.join(" ");
    card.append(warning);
  }

  const actions = document.createElement("div");
  actions.className = "snippet-card-actions";
  actions.append(
    createAction("rename", "✎", `Rename ${model.name}`),
    createAction("export", "⤓", `Export ${model.name} as a scene file`),
    createAction("delete", "✕", `Delete ${model.name}`),
  );
  card.append(actions);
  return card;
}

function createAction(action: string, glyph: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.snippetAction = action;
  button.textContent = glyph;
  button.title = label;
  button.setAttribute("aria-label", label);
  return button;
}

function drawThumbnail(canvas: HTMLCanvasElement, world: World): void {
  const logicalWidth = canvas.clientWidth;
  const logicalHeight = canvas.clientHeight;
  if (logicalWidth === 0 || logicalHeight === 0) {
    return;
  }
  const pixelRatio = (window.devicePixelRatio || 1) * THUMBNAIL_SUPERSAMPLING;
  const backingWidth = Math.max(1, Math.round(logicalWidth * pixelRatio));
  const backingHeight = Math.max(1, Math.round(logicalHeight * pixelRatio));
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Canvas 2D is not supported by this browser");
  }
  context.setTransform(backingWidth / logicalWidth, 0, 0, backingHeight / logicalHeight, 0, 0);
  context.clearRect(0, 0, logicalWidth, logicalHeight);

  const cellSize = Math.min(
    (logicalWidth - THUMBNAIL_PADDING * 2) / world.width,
    (logicalHeight - THUMBNAIL_PADDING * 2) / world.height,
    MAX_THUMBNAIL_CELL_SIZE,
  );
  if (cellSize <= 0) {
    return;
  }
  const originX = (logicalWidth - world.width * cellSize) / 2;
  const originY = (logicalHeight - world.height * cellSize) / 2;
  for (const body of collectWorldBodies(world)) {
    drawBody(context, originX, originY, cellSize, body);
  }
}

function eventTarget(event: Event): HTMLElement | null {
  return event.target instanceof HTMLElement ? event.target : null;
}

function requireSnippetId(card: HTMLElement): string {
  const id = card.dataset.snippetId;
  if (id === undefined || id.length === 0) {
    throw new Error("Snippet card is missing its snippet ID");
  }
  return id;
}
