import { collectWorldBodies } from "../render/body-cells";
import { drawBody, type BodyCell } from "../render/tile-renderer";
import {
  componentConfigurationForKind,
  MAX_ROM_DIMENSION,
  MAX_SIGNAL_LABEL_LENGTH,
  MIN_ROM_DIMENSION,
  type ConfigurableComponentSnapshot,
} from "../simulation/configurable-components";
import { CIRCUIT_CHARGE_COLORS, type Charge } from "../simulation/circuit";
import {
  MAX_RUNE_ARRAY_DESCRIPTION_LENGTH,
  MAX_RUNE_ARRAY_DIMENSION,
  MIN_RUNE_ARRAY_DIMENSION,
} from "../simulation/rune-array";
import { TILE_DEFINITIONS, TileKind } from "../simulation/tile";
import { expectDefined } from "../util/assert";

export type ComponentConfigurationSubmission =
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "text"; readonly value: string; readonly category: string }
  | {
      readonly type: "grid";
      readonly width: number;
      readonly height: number;
      readonly values: readonly Charge[];
      readonly ignoreZeros: boolean;
    }
  | {
      readonly type: "array";
      readonly width: number;
      readonly height: number;
      readonly description: string;
      /** Whether the player asked to open the array's inner board after saving. */
      readonly open: boolean;
    };

export class ComponentConfigurationDialog {
  private readonly form: HTMLFormElement;
  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private readonly numericPanel: HTMLElement;
  private readonly numericLabel: HTMLElement;
  private readonly numericInput: HTMLInputElement;
  private readonly romPanel: HTMLElement;
  private readonly romWidth: HTMLInputElement;
  private readonly romHeight: HTMLInputElement;
  private readonly romGrid: HTMLElement;
  private readonly checkerPanel: HTMLElement;
  private readonly checkerIgnoreZeros: HTMLInputElement;
  private readonly textPanel: HTMLElement;
  private readonly textLabel: HTMLElement;
  private readonly textInput: HTMLInputElement;
  private readonly categoryInput: HTMLInputElement;
  private readonly arrayPanel: HTMLElement;
  private readonly arrayWidth: HTMLInputElement;
  private readonly arrayHeight: HTMLInputElement;
  private readonly arrayDescription: HTMLInputElement;
  private readonly arrayOpenButton: HTMLButtonElement;
  private readonly arrayThumbnail: HTMLCanvasElement;
  private readonly arrayThumbnailCaption: HTMLElement;
  private readonly arrayThumbnailObserver: ResizeObserver;
  private arrayPreview: {
    readonly width: number;
    readonly height: number;
    readonly bodies: BodyCell[][];
  } | null = null;
  private readonly cancelButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private submit: ((submission: ComponentConfigurationSubmission) => void) | null = null;
  private romValues: Charge[] = [];
  private currentKind = TileKind.Empty;
  private openArrayAfterSave = false;
  private romStroke: {
    readonly pointerId: number;
    readonly button: number;
    readonly value: Charge;
    x: number;
    y: number;
  } | null = null;

  constructor(private readonly dialog: HTMLDialogElement) {
    this.form = requiredDescendant(dialog, "[data-component-configuration-form]");
    this.title = requiredDescendant(dialog, "[data-component-configuration-title]");
    this.description = requiredDescendant(dialog, "[data-component-configuration-description]");
    this.numericPanel = requiredDescendant(dialog, "[data-component-numeric-panel]");
    this.numericLabel = requiredDescendant(dialog, "[data-component-numeric-label]");
    this.numericInput = requiredDescendant(dialog, "[data-component-numeric-input]");
    this.romPanel = requiredDescendant(dialog, "[data-component-rom-panel]");
    this.romWidth = requiredDescendant(dialog, "[data-component-rom-width]");
    this.romHeight = requiredDescendant(dialog, "[data-component-rom-height]");
    this.romGrid = requiredDescendant(dialog, "[data-component-rom-grid]");
    this.checkerPanel = requiredDescendant(dialog, "[data-component-checker-panel]");
    this.checkerIgnoreZeros = requiredDescendant(dialog, "[data-component-checker-ignore-zeros]");
    this.textPanel = requiredDescendant(dialog, "[data-component-text-panel]");
    this.textLabel = requiredDescendant(dialog, "[data-component-text-label]");
    this.textInput = requiredDescendant(dialog, "[data-component-text-input]");
    this.categoryInput = requiredDescendant(dialog, "[data-component-category-input]");
    this.categoryInput.maxLength = MAX_SIGNAL_LABEL_LENGTH;
    this.arrayPanel = requiredDescendant(dialog, "[data-component-array-panel]");
    this.arrayWidth = requiredDescendant(dialog, "[data-component-array-width]");
    this.arrayHeight = requiredDescendant(dialog, "[data-component-array-height]");
    this.arrayDescription = requiredDescendant(dialog, "[data-component-array-description]");
    this.arrayOpenButton = requiredDescendant(dialog, "[data-component-array-open]");
    this.arrayThumbnail = requiredDescendant(dialog, "[data-component-array-thumbnail]");
    this.arrayThumbnailCaption = requiredDescendant(dialog, "[data-component-array-thumbnail-caption]");
    this.arrayThumbnailObserver = new ResizeObserver(() => this.renderArrayThumbnail());
    for (const input of [this.arrayWidth, this.arrayHeight]) {
      input.min = String(MIN_RUNE_ARRAY_DIMENSION);
      input.max = String(MAX_RUNE_ARRAY_DIMENSION);
      input.step = "2";
      input.addEventListener("input", () => this.renderArrayThumbnail());
    }
    this.arrayDescription.maxLength = MAX_RUNE_ARRAY_DESCRIPTION_LENGTH;
    this.arrayOpenButton.addEventListener("click", () => {
      this.openArrayAfterSave = true;
      this.form.requestSubmit();
    });

    this.cancelButton = requiredDescendant(dialog, "[data-component-configuration-cancel]");
    this.saveButton = requiredDescendant(this.form, 'button[type="submit"]');
    this.cancelButton.addEventListener("click", () => this.close());
    this.dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;
      this.openArrayAfterSave = false;
      this.commit();
    });
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.openArrayAfterSave = false;
      this.commit();
    });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.commit();
    });
    this.romWidth.addEventListener("input", () => this.resizeRomDraft());
    this.romHeight.addEventListener("input", () => this.resizeRomDraft());
    for (const value of [-1, 0, 1] as const) {
      const button = requiredDescendant<HTMLButtonElement>(dialog, `[data-rom-fill="${value}"]`);
      button.style.setProperty("--charge-color", value === 0 ? "#17131f" : CIRCUIT_CHARGE_COLORS[value]);
      button.addEventListener("click", () => {
        this.endRomStroke();
        this.romValues.fill(value);
        for (const cell of this.romGrid.querySelectorAll<HTMLButtonElement>("button")) {
          this.updateRomCell(cell, value);
        }
      });
    }
    this.romGrid.addEventListener("pointerdown", (event) => {
      if (this.submit === null || this.romStroke !== null || (event.button !== 0 && event.button !== 2)) return;
      const cell = this.romCellAt(event.clientX, event.clientY);
      if (cell === null) return;
      event.preventDefault();
      cell.focus();
      const current = expectDefined(this.romValues[Number(cell.dataset.romIndex)], "ROM draft value");
      const value: Charge = event.button === 2 ? 0 : current === 1 ? -1 : 1;
      this.romStroke = {
        pointerId: event.pointerId, button: event.button, value,
        x: event.clientX, y: event.clientY,
      };
      this.romGrid.setPointerCapture(event.pointerId);
      this.paintRomCell(cell, value);
    });
    this.romGrid.addEventListener("pointermove", (event) => {
      const stroke = this.romStroke;
      if (stroke === null || stroke.pointerId !== event.pointerId) return;
      if ((event.buttons & (stroke.button === 0 ? 1 : 2)) === 0) {
        this.endRomStroke();
        return;
      }
      const first = requiredDescendant<HTMLButtonElement>(this.romGrid, "button");
      const bounds = first.getBoundingClientRect();
      const steps = Math.max(1, Math.ceil(
        Math.hypot(event.clientX - stroke.x, event.clientY - stroke.y) /
        (Math.min(bounds.width, bounds.height) / 2),
      ));
      for (let step = 1; step <= steps; step += 1) {
        const cell = this.romCellAt(
          stroke.x + (event.clientX - stroke.x) * step / steps,
          stroke.y + (event.clientY - stroke.y) * step / steps,
        );
        if (cell !== null) this.paintRomCell(cell, stroke.value);
      }
      stroke.x = event.clientX;
      stroke.y = event.clientY;
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      this.romGrid.addEventListener(type, (event) => {
        if (event.pointerId === this.romStroke?.pointerId) this.endRomStroke();
      });
    }
    this.romGrid.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("blur", () => this.endRomStroke());
    this.dialog.addEventListener("close", () => {
      this.endRomStroke();
      if (!this.dialog.open) this.clearArrayPreview();
    });
  }

  get open(): boolean {
    return this.dialog.open;
  }

  show(
    kind: TileKind,
    state: ConfigurableComponentSnapshot,
    submit: ((submission: ComponentConfigurationSubmission) => void) | null,
  ): void {
    const configuration = componentConfigurationForKind(kind);
    if (configuration === null) {
      throw new Error(`${TILE_DEFINITIONS[kind].name} is not configurable`);
    }
    this.currentKind = kind;
    this.clearArrayPreview();
    this.submit = submit;
    this.title.textContent =
      `${submit === null ? "VIEW" : "CONFIGURE"} ${TILE_DEFINITIONS[kind].name.toUpperCase()}`;
    this.numericPanel.hidden = configuration.type !== "number";
    this.romPanel.hidden = configuration.type !== "grid";
    this.textPanel.hidden = configuration.type !== "text";
    this.arrayPanel.hidden = configuration.type !== "array";
    this.checkerPanel.hidden = kind !== TileKind.Checker;
    this.checkerIgnoreZeros.disabled = kind !== TileKind.Checker || submit === null;
    this.checkerIgnoreZeros.checked = state.type === "checker" && state.ignoreZeros;
    this.numericInput.disabled = configuration.type !== "number";
    this.romWidth.disabled = configuration.type !== "grid";
    this.romHeight.disabled = configuration.type !== "grid";
    this.textInput.disabled = configuration.type !== "text";
    this.categoryInput.disabled = configuration.type !== "text";
    this.arrayWidth.disabled = configuration.type !== "array";
    this.arrayHeight.disabled = configuration.type !== "array";
    this.arrayDescription.disabled = configuration.type !== "array";
    for (const input of this.form.querySelectorAll<HTMLInputElement>("input")) {
      input.readOnly = submit === null;
    }
    for (const button of this.form.querySelectorAll<HTMLButtonElement>("[data-rom-fill]")) {
      button.hidden = submit === null;
    }
    this.arrayOpenButton.hidden = submit === null;
    this.saveButton.hidden = submit === null;
    this.cancelButton.textContent = submit === null ? "CLOSE" : "CANCEL";
    this.openArrayAfterSave = false;

    if (configuration.type === "number") {
      if (state.type !== "delay" && state.type !== "counter") {
        throw new Error(`${TILE_DEFINITIONS[kind].name} is missing numeric state`);
      }
      this.numericLabel.textContent = configuration.label.toUpperCase();
      this.numericInput.min = String(configuration.minimum);
      this.numericInput.max = String(configuration.maximum);
      this.numericInput.value = String(
        state.type === "delay" ? state.length : state.threshold,
      );
      this.description.textContent =
        `Choose an integer from ${configuration.minimum} through ${configuration.maximum}.`;
    } else if (configuration.type === "text") {
      if (state.type !== "monitor" && state.type !== "grapher") {
        throw new Error(`${TILE_DEFINITIONS[kind].name} is missing signal name state`);
      }
      this.textLabel.textContent = configuration.label.toUpperCase();
      this.textInput.maxLength = configuration.maximumLength;
      this.textInput.value = state.label;
      this.categoryInput.value = state.category;
      this.description.textContent =
        `Name the signal panel line, using at most ${configuration.maximumLength} characters. ` +
        "Leave it empty to show the line number. " +
        `Category groups signal lines together; use at most ${MAX_SIGNAL_LABEL_LENGTH} characters, ` +
        "or leave it empty for no category.";
    } else if (configuration.type === "array") {
      if (state.type !== "array") {
        throw new Error(`${TILE_DEFINITIONS[kind].name} is missing array state`);
      }
      this.arrayWidth.value = String(state.world.width);
      this.arrayHeight.value = String(state.world.height);
      this.arrayDescription.value = state.description;
      this.arrayPreview = {
        width: state.world.width,
        height: state.world.height,
        bodies: collectWorldBodies(state.world),
      };
      this.description.textContent =
        `Choose odd dimensions from ${MIN_RUNE_ARRAY_DIMENSION} through ` +
        `${MAX_RUNE_ARRAY_DIMENSION}; existing contents stay centered. The four edge-center ` +
        "cells connect to the array's sides. Open the array to place components inside it " +
        "with the usual tools, or press Enter while hovering it on the board.";
    } else {
      if (state.type !== "rom" && state.type !== "checker") {
        throw new Error(`${TILE_DEFINITIONS[kind].name} is missing value grid state`);
      }
      this.romWidth.value = String(state.width);
      this.romHeight.value = String(state.height);
      this.romValues = [...state.values];
      this.description.textContent =
        (state.type === "checker" ? "Expected values are read row by row. " : "") +
        "Left-click to alternate +1 and -1; drag to paint that value. " +
        "Right-click or right-drag clears to 0. Fill buttons replace the whole grid.";
      this.renderRomGrid(state.width, state.height);
    }
    if (submit === null) {
      this.description.textContent = "Read-only: this component is outside the editable region.";
    }

    this.dialog.showModal();
    if (this.arrayPreview !== null) {
      this.arrayThumbnailObserver.observe(this.arrayThumbnail);
      this.renderArrayThumbnail();
    }
    if (submit === null) {
      this.cancelButton.focus();
    } else if (configuration.type === "number") {
      this.numericInput.focus();
      this.numericInput.select();
    } else if (configuration.type === "text") {
      this.textInput.focus();
      this.textInput.select();
    } else if (configuration.type === "array") {
      this.arrayDescription.focus();
    } else {
      this.romWidth.focus();
    }
  }

  close(): void {
    this.endRomStroke();
    this.clearArrayPreview();
    this.submit = null;
    if (this.dialog.open) {
      this.dialog.close();
    }
  }

  private commit(): void {
    if (this.submit === null) {
      this.close();
      return;
    }
    const configuration = componentConfigurationForKind(this.currentKind);
    if (configuration === null) {
      throw new Error("Configuration dialog has no active component");
    }
    const invalidSequence = this.currentKind === TileKind.Checker &&
      this.checkerIgnoreZeros.checked && this.romValues.includes(0);
    this.checkerIgnoreZeros.setCustomValidity(invalidSequence
      ? "When ignoring zero inputs, every expected value must be +1 or -1."
      : "");
    if (!this.form.reportValidity()) {
      this.openArrayAfterSave = false;
      this.checkerIgnoreZeros.setCustomValidity("");
      return;
    }
    const submit = this.submit;
    if (configuration.type === "number") {
      submit({ type: "number", value: this.numericInput.valueAsNumber });
    } else if (configuration.type === "text") {
      submit({
        type: "text",
        value: this.textInput.value.trim(),
        category: this.categoryInput.value.trim(),
      });
    } else if (configuration.type === "array") {
      const open = this.openArrayAfterSave;
      this.openArrayAfterSave = false;
      submit({
        type: "array",
        width: this.arrayWidth.valueAsNumber,
        height: this.arrayHeight.valueAsNumber,
        description: this.arrayDescription.value.trim(),
        open,
      });
    } else {
      const width = this.romWidth.valueAsNumber;
      const height = this.romHeight.valueAsNumber;
      if (this.romValues.length !== width * height) {
        throw new Error("Grid draft dimensions do not match its values");
      }
      submit({
        type: "grid", width, height, values: [...this.romValues],
        ignoreZeros: this.currentKind === TileKind.Checker && this.checkerIgnoreZeros.checked,
      });
    }
    this.close();
  }

  private clearArrayPreview(): void {
    this.arrayThumbnailObserver.disconnect();
    this.arrayPreview = null;
  }

  private renderArrayThumbnail(): void {
    const preview = this.arrayPreview;
    if (preview === null || !this.dialog.open) return;
    const valid = [this.arrayWidth, this.arrayHeight].every((input) =>
      input.validity.valid && Number.isInteger(input.valueAsNumber) &&
      input.valueAsNumber >= MIN_RUNE_ARRAY_DIMENSION &&
      input.valueAsNumber <= MAX_RUNE_ARRAY_DIMENSION &&
      input.valueAsNumber % 2 === 1,
    );
    const width = valid ? this.arrayWidth.valueAsNumber : preview.width;
    const height = valid ? this.arrayHeight.valueAsNumber : preview.height;
    const shrinking = width < preview.width || height < preview.height;
    this.arrayThumbnailCaption.textContent = valid
      ? `${width} × ${height} centered bounds (gold outline). ` +
        (shrinking ? "Shaded contents will be cropped on save." : "Read-only preview of current contents.")
      : "Current contents shown. Enter valid odd dimensions to preview the centered bounds.";
    this.arrayThumbnail.setAttribute(
      "aria-label",
      `Rune array contents, currently ${preview.width} by ${preview.height}. ` +
      this.arrayThumbnailCaption.textContent,
    );

    const canvas = this.arrayThumbnail;
    const logicalWidth = canvas.clientWidth;
    const logicalHeight = canvas.clientHeight;
    if (logicalWidth === 0 || logicalHeight === 0) return;
    // Match snippet thumbnails: supersample the shared tile/body renderer.
    const pixelRatio = (window.devicePixelRatio || 1) * 2;
    const backingWidth = Math.max(1, Math.round(logicalWidth * pixelRatio));
    const backingHeight = Math.max(1, Math.round(logicalHeight * pixelRatio));
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas 2D is not supported by this browser");
    context.setTransform(backingWidth / logicalWidth, 0, 0, backingHeight / logicalHeight, 0, 0);
    context.clearRect(0, 0, logicalWidth, logicalHeight);
    const columns = Math.max(preview.width, width);
    const rows = Math.max(preview.height, height);
    const cellSize = Math.min((logicalWidth - 12) / columns, (logicalHeight - 12) / rows, 32);
    if (cellSize <= 0) return;
    const originX = (logicalWidth - preview.width * cellSize) / 2;
    const originY = (logicalHeight - preview.height * cellSize) / 2;
    const left = (logicalWidth - width * cellSize) / 2;
    const top = (logicalHeight - height * cellSize) / 2;
    const gridLeft = (logicalWidth - columns * cellSize) / 2;
    const gridTop = (logicalHeight - rows * cellSize) / 2;
    context.fillStyle = "#191309";
    context.fillRect(originX, originY, preview.width * cellSize, preview.height * cellSize);
    context.strokeStyle = "#55412b";
    context.lineWidth = 0.5;
    context.beginPath();
    for (let x = 0; x <= columns; x += 1) {
      context.moveTo(gridLeft + x * cellSize, gridTop);
      context.lineTo(gridLeft + x * cellSize, gridTop + rows * cellSize);
    }
    for (let y = 0; y <= rows; y += 1) {
      context.moveTo(gridLeft, gridTop + y * cellSize);
      context.lineTo(gridLeft + columns * cellSize, gridTop + y * cellSize);
    }
    context.stroke();
    for (const body of preview.bodies) {
      drawBody(context, originX, originY, cellSize, body);
    }
    if (valid && shrinking) {
      context.save();
      context.beginPath();
      context.rect(originX, originY, preview.width * cellSize, preview.height * cellSize);
      context.clip();
      context.beginPath();
      context.rect(originX, originY, preview.width * cellSize, preview.height * cellSize);
      context.rect(left, top, width * cellSize, height * cellSize);
      context.fillStyle = "rgb(125 26 26 / 58%)";
      context.fill("evenodd");
      context.restore();
    }
    if (valid) {
      context.strokeStyle = "#edc779";
      context.lineWidth = 2;
      context.setLineDash([5, 3]);
      context.strokeRect(left, top, width * cellSize, height * cellSize);
      context.setLineDash([]);
    }
  }

  private resizeRomDraft(): void {
    if (!this.romWidth.validity.valid || !this.romHeight.validity.valid) {
      return;
    }
    const width = this.romWidth.valueAsNumber;
    const height = this.romHeight.valueAsNumber;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < MIN_ROM_DIMENSION ||
      width > MAX_ROM_DIMENSION ||
      height < MIN_ROM_DIMENSION ||
      height > MAX_ROM_DIMENSION
    ) {
      return;
    }
    const values = new Array<Charge>(width * height).fill(0);
    const copyLength = Math.min(values.length, this.romValues.length);
    for (let index = 0; index < copyLength; index += 1) {
      values[index] = expectDefined(this.romValues[index], "ROM draft value");
    }
    this.romValues = values;
    this.renderRomGrid(width, height);
  }

  private renderRomGrid(width: number, height: number): void {
    this.endRomStroke();
    this.romGrid.style.setProperty("--rom-width", String(width));
    const cells: HTMLButtonElement[] = [];
    for (let index = 0; index < width * height; index += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "rom-configuration-cell";
      cell.disabled = this.submit === null;
      cell.dataset.romIndex = String(index);
      this.updateRomCell(cell, expectDefined(this.romValues[index], "ROM draft value"));
      cell.addEventListener("click", (event) => {
        // Pointer gestures paint on press; keyboard activation still alternates.
        if (event.detail !== 0) return;
        const value = expectDefined(this.romValues[index], "ROM draft value");
        this.paintRomCell(cell, value === 1 ? -1 : 1);
      });
      cells.push(cell);
    }
    this.romGrid.replaceChildren(...cells);
  }

  private romCellAt(x: number, y: number): HTMLButtonElement | null {
    const element = document.elementFromPoint(x, y);
    return element instanceof HTMLButtonElement && element.parentElement === this.romGrid
      ? element : null;
  }

  private paintRomCell(cell: HTMLButtonElement, value: Charge): void {
    this.romValues[Number(cell.dataset.romIndex)] = value;
    this.updateRomCell(cell, value);
  }

  private endRomStroke(): void {
    const stroke = this.romStroke;
    this.romStroke = null;
    if (stroke !== null && this.romGrid.hasPointerCapture(stroke.pointerId)) {
      this.romGrid.releasePointerCapture(stroke.pointerId);
    }
  }

  private updateRomCell(cell: HTMLButtonElement, value: Charge): void {
    cell.dataset.charge = String(value);
    cell.style.backgroundColor = value === 0 ? "#17131f" : CIRCUIT_CHARGE_COLORS[value];
    cell.setAttribute("aria-label", `ROM value ${value > 0 ? "+1" : String(value)}`);
    cell.title = value > 0 ? "+1" : String(value);
  }
}

function requiredDescendant<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required component configuration element ${selector}`);
  }
  return element;
}
