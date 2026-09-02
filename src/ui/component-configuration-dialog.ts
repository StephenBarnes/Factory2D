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
  private submit: ((submission: ComponentConfigurationSubmission) => void) | null = null;
  private romValues: Charge[] = [];
  private currentKind = TileKind.Empty;
  private openArrayAfterSave = false;

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

    requiredDescendant<HTMLButtonElement>(dialog, "[data-component-configuration-cancel]")
      .addEventListener("click", () => this.close());
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.commit();
    });
    this.romWidth.addEventListener("input", () => this.resizeRomDraft());
    this.romHeight.addEventListener("input", () => this.resizeRomDraft());
  }

  get open(): boolean {
    return this.dialog.open;
  }

  show(
    kind: TileKind,
    state: ConfigurableComponentSnapshot,
    submit: (submission: ComponentConfigurationSubmission) => void,
  ): void {
    const configuration = componentConfigurationForKind(kind);
    if (configuration === null) {
      throw new Error(`${TILE_DEFINITIONS[kind].name} is not configurable`);
    }
    this.currentKind = kind;
    this.submit = submit;
    this.title.textContent = `CONFIGURE ${TILE_DEFINITIONS[kind].name.toUpperCase()}`;
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
      this.description.textContent = state.type === "checker"
        ? "Expected values are read row by row. Left-click cells to alternate +1 and -1. " +
          "Right-click clears a cell to 0."
        : "Left-click cells to alternate +1 and -1. Right-click clears a cell to 0.";
      this.renderRomGrid(state.width, state.height);
    }

    this.dialog.showModal();
    if (configuration.type === "number") {
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
    this.submit = null;
    if (this.dialog.open) {
      this.dialog.close();
    }
  }

  private commit(): void {
    const configuration = componentConfigurationForKind(this.currentKind);
    if (configuration === null || this.submit === null) {
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
    this.romGrid.style.setProperty("--rom-width", String(width));
    const cells: HTMLButtonElement[] = [];
    for (let index = 0; index < width * height; index += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "rom-configuration-cell";
      cell.dataset.romIndex = String(index);
      this.updateRomCell(cell, expectDefined(this.romValues[index], "ROM draft value"));
      cell.addEventListener("click", () => {
        const value = expectDefined(this.romValues[index], "ROM draft value");
        const nextValue: Charge = value === 0 ? 1 : value === 1 ? -1 : 1;
        this.romValues[index] = nextValue;
        this.updateRomCell(cell, nextValue);
      });
      cell.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.romValues[index] = 0;
        this.updateRomCell(cell, 0);
      });
      cells.push(cell);
    }
    this.romGrid.replaceChildren(...cells);
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
