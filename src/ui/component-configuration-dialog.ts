import {
  componentConfigurationForKind,
  MAX_ROM_DIMENSION,
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
  | { readonly type: "text"; readonly value: string }
  | {
      readonly type: "grid";
      readonly width: number;
      readonly height: number;
      readonly values: readonly Charge[];
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
  private readonly textPanel: HTMLElement;
  private readonly textLabel: HTMLElement;
  private readonly textInput: HTMLInputElement;
  private readonly arrayPanel: HTMLElement;
  private readonly arrayWidth: HTMLInputElement;
  private readonly arrayHeight: HTMLInputElement;
  private readonly arrayDescription: HTMLInputElement;
  private readonly arrayOpenButton: HTMLButtonElement;
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
    this.textPanel = requiredDescendant(dialog, "[data-component-text-panel]");
    this.textLabel = requiredDescendant(dialog, "[data-component-text-label]");
    this.textInput = requiredDescendant(dialog, "[data-component-text-input]");
    this.arrayPanel = requiredDescendant(dialog, "[data-component-array-panel]");
    this.arrayWidth = requiredDescendant(dialog, "[data-component-array-width]");
    this.arrayHeight = requiredDescendant(dialog, "[data-component-array-height]");
    this.arrayDescription = requiredDescendant(dialog, "[data-component-array-description]");
    this.arrayOpenButton = requiredDescendant(dialog, "[data-component-array-open]");
    for (const input of [this.arrayWidth, this.arrayHeight]) {
      input.min = String(MIN_RUNE_ARRAY_DIMENSION);
      input.max = String(MAX_RUNE_ARRAY_DIMENSION);
      input.step = "2";
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
    this.dialog.addEventListener("close", () => this.endRomStroke());
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
    this.submit = submit;
    this.title.textContent =
      `${submit === null ? "VIEW" : "CONFIGURE"} ${TILE_DEFINITIONS[kind].name.toUpperCase()}`;
    this.numericPanel.hidden = configuration.type !== "number";
    this.romPanel.hidden = configuration.type !== "grid";
    this.textPanel.hidden = configuration.type !== "text";
    this.arrayPanel.hidden = configuration.type !== "array";
    this.numericInput.disabled = configuration.type !== "number";
    this.romWidth.disabled = configuration.type !== "grid";
    this.romHeight.disabled = configuration.type !== "grid";
    this.textInput.disabled = configuration.type !== "text";
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
      this.description.textContent =
        `Name the signal panel line, using at most ${configuration.maximumLength} characters. ` +
        "Leave it empty to show the line number.";
    } else if (configuration.type === "array") {
      if (state.type !== "array") {
        throw new Error(`${TILE_DEFINITIONS[kind].name} is missing array state`);
      }
      this.arrayWidth.value = String(state.world.width);
      this.arrayHeight.value = String(state.world.height);
      this.arrayDescription.value = state.description;
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
    if (!this.form.reportValidity()) {
      this.openArrayAfterSave = false;
      return;
    }
    const submit = this.submit;
    if (configuration.type === "number") {
      submit({ type: "number", value: this.numericInput.valueAsNumber });
    } else if (configuration.type === "text") {
      submit({ type: "text", value: this.textInput.value.trim() });
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
      submit({ type: "grid", width, height, values: [...this.romValues] });
    }
    this.close();
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
