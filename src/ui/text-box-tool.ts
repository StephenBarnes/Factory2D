import type { WorkshopSurfaceController } from "../game/workshop-surface-controller";
import type { CanvasRenderer } from "../render/canvas-renderer";
import type { GridPoint } from "../render/grid-drag";
import { exceedsPanDragThreshold } from "../render/pointer-gesture";
import { MAX_TEXT_BOXES, MAX_TEXT_BOX_TEXT_LENGTH, type TextBox } from "../simulation/text-box";
import type { World } from "../simulation/world";

interface TextBoxGesture {
  readonly world: World;
  readonly renderer: CanvasRenderer;
  readonly origin: GridPoint;
  readonly clientX: number;
  readonly clientY: number;
  readonly existing: TextBox | null;
  readonly erase: boolean;
  preview: TextBox;
  dragged: boolean;
}

/** Free-positioned annotations; tile permissions deliberately do not constrain player notes. */
export class TextBoxTool {
  private gesture: TextBoxGesture | null = null;
  private saveEditor: (() => void) | null = null;
  private composing = false;
  private readonly textarea: HTMLTextAreaElement;

  constructor(
    private readonly surface: WorkshopSurfaceController,
    private readonly dialog: HTMLDialogElement,
    private readonly commitEdit: () => void,
  ) {
    const textarea = dialog.querySelector<HTMLTextAreaElement>("textarea");
    const form = dialog.querySelector("form");
    const cancel = dialog.querySelector<HTMLButtonElement>("[data-text-box-cancel]");
    if (textarea === null || form === null || cancel === null) {
      throw new Error("Text box editor controls are missing");
    }
    this.textarea = textarea;
    textarea.maxLength = MAX_TEXT_BOX_TEXT_LENGTH;
    textarea.addEventListener("input", () => textarea.setCustomValidity(""));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!this.composing) this.saveEditor?.();
    });
    cancel.addEventListener("click", () => this.closeEditor());
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!this.composing) this.closeEditor();
    });
    textarea.addEventListener("compositionstart", () => { this.composing = true; });
    textarea.addEventListener("compositionend", () => { this.composing = false; });
    dialog.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (this.composing || event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeEditor();
      } else if (event.key === "Enter" && !event.shiftKey && event.target === textarea) {
        event.preventDefault();
        this.saveEditor?.();
      }
    });
    dialog.addEventListener("keyup", (event) => event.stopPropagation());
    dialog.addEventListener("close", () => {
      this.saveEditor = null;
      this.composing = false;
    });
  }

  get open(): boolean {
    return this.dialog.open;
  }

  private canEdit(box: TextBox | null = null): boolean {
    return this.surface.session.editingState.editable &&
      (this.surface.viewDepth === 0 || this.surface.editableRegion === null) &&
      (box === null || box.owner === "player" || this.surface.session.puzzleAuthoring !== null);
  }

  begin(point: GridPoint, clientX: number, clientY: number, erase: boolean): void {
    this.cancelGesture();
    const world = this.surface.world;
    if (!this.canEdit() || this.open || point.x < 0 || point.y < 0 ||
        point.x >= world.width || point.y >= world.height) return;
    let existing: TextBox | null = null;
    for (let index = world.textBoxes.length - 1; index >= 0; index -= 1) {
      const box = world.textBoxes[index];
      if (box !== undefined && point.x >= box.x && point.y >= box.y &&
          point.x <= box.x + box.width && point.y <= box.y + box.height) {
        existing = box;
        break;
      }
    }
    if (!this.canEdit(existing) || (erase && existing === null)) return;
    if (existing === null && world.textBoxes.length >= MAX_TEXT_BOXES) {
      window.alert(`A board can contain at most ${MAX_TEXT_BOXES} text boxes.`);
      return;
    }
    const width = Math.min(4, world.width);
    const height = Math.min(2, world.height);
    const preview: TextBox = existing ?? {
      id: crypto.randomUUID(),
      x: Math.min(point.x, world.width - width),
      y: Math.min(point.y, world.height - height),
      width,
      height,
      text: "",
      owner: this.surface.session.puzzleAuthoring === null ? "player" : "author",
    };
    this.gesture = {
      world, renderer: this.surface.renderer, origin: point, clientX, clientY,
      existing, erase, preview, dragged: false,
    };
    if (!erase) this.surface.renderer.setTextBoxPreview(preview);
  }

  move(point: GridPoint, clientX: number, clientY: number): void {
    const gesture = this.gesture;
    if (gesture === null) return;
    if (gesture.world !== this.surface.world || !this.canEdit(gesture.existing)) {
      this.cancelGesture();
      return;
    }
    if (gesture.erase) return;
    gesture.dragged ||= exceedsPanDragThreshold(clientX - gesture.clientX, clientY - gesture.clientY);
    if (!gesture.dragged) return;
    const { world, existing, origin } = gesture;
    if (existing !== null) {
      gesture.preview = {
        ...existing,
        x: Math.max(0, Math.min(world.width - existing.width, existing.x + point.x - origin.x)),
        y: Math.max(0, Math.min(world.height - existing.height, existing.y + point.y - origin.y)),
      };
    } else {
      const x = Math.max(0, Math.min(world.width, point.x));
      const y = Math.max(0, Math.min(world.height, point.y));
      const width = Math.max(Math.min(0.5, world.width), Math.abs(x - origin.x));
      const height = Math.max(Math.min(0.5, world.height), Math.abs(y - origin.y));
      gesture.preview = {
        ...gesture.preview,
        x: Math.min(Math.min(x, origin.x), world.width - width),
        y: Math.min(Math.min(y, origin.y), world.height - height),
        width, height,
      };
    }
    gesture.renderer.setTextBoxPreview(gesture.preview);
  }

  finish(): void {
    const gesture = this.gesture;
    this.cancelGesture();
    if (gesture === null || gesture.world !== this.surface.world || !this.canEdit(gesture.existing)) return;
    const { world, existing, preview } = gesture;
    if (gesture.erase) {
      world.setTextBoxes(world.textBoxes.filter((box) => box.id !== existing?.id));
      this.commitEdit();
    } else if (existing !== null && gesture.dragged) {
      if (existing.x !== preview.x || existing.y !== preview.y) {
        world.setTextBoxes(world.textBoxes.map((box) => box.id === existing.id ? preview : box));
        this.commitEdit();
      }
    } else {
      this.showEditor(world, preview, existing);
    }
  }

  cancelGesture(): void {
    this.gesture?.renderer.setTextBoxPreview(null);
    this.gesture = null;
  }

  cancel(): void {
    this.cancelGesture();
    this.closeEditor();
  }

  private closeEditor(): void {
    this.saveEditor = null;
    this.composing = false;
    if (this.dialog.open) this.dialog.close();
  }

  private showEditor(world: World, box: TextBox, existing: TextBox | null): void {
    this.textarea.value = box.text;
    this.textarea.setCustomValidity("");
    this.saveEditor = () => {
      if (this.surface.world !== world || !this.canEdit(existing) ||
          (existing !== null && !world.textBoxes.some((entry) => entry.id === existing.id))) {
        this.closeEditor();
        return;
      }
      const text = this.textarea.value;
      this.textarea.setCustomValidity(text.trim() === "" ? "Enter text for this box." : "");
      if (!this.textarea.reportValidity()) return;
      if (existing === null || text !== existing.text) {
        const updated = { ...box, text };
        world.setTextBoxes(existing === null
          ? [...world.textBoxes, updated]
          : world.textBoxes.map((entry) => entry.id === existing.id ? updated : entry));
        this.commitEdit();
      }
      this.closeEditor();
    };
    this.dialog.showModal();
    this.textarea.focus();
    this.textarea.select();
  }
}
