import {
  componentConfigurationForKind,
  MAX_ROM_DIMENSION,
  MIN_ROM_DIMENSION,
  type ConfigurableComponentSnapshot,
} from "../simulation/configurable-components";
import { CIRCUIT_CHARGE_COLORS, type Charge } from "../simulation/circuit";
import { TILE_DEFINITIONS, TileKind } from "../simulation/tile";
import { expectDefined } from "../util/assert";

export type ComponentConfigurationSubmission =
  | { readonly type: "number"; readonly value: number }
  | {
      readonly type: "rom";
      readonly width: number;
      readonly height: number;
      readonly values: readonly Charge[];
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
  private submit: ((submission: ComponentConfigurationSubmission) => void) | null = null;
  private romValues: Charge[] = [];
  private currentKind = TileKind.Empty;

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
    this.romPanel.hidden = configuration.type !== "rom";
    this.numericInput.disabled = configuration.type !== "number";
    this.romWidth.disabled = configuration.type !== "rom";
    this.romHeight.disabled = configuration.type !== "rom";

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
    } else {
      if (state.type !== "rom") {
        throw new Error("ROM is missing configuration state");
      }
      this.romWidth.value = String(state.width);
      this.romHeight.value = String(state.height);
      this.romValues = [...state.values];
      this.description.textContent =
        "Left-click cells to alternate +1 and -1. Right-click clears a cell to 0.";
      this.renderRomGrid(state.width, state.height);
    }

    this.dialog.showModal();
    if (configuration.type === "number") {
      this.numericInput.focus();
      this.numericInput.select();
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
      return;
    }
    const submit = this.submit;
    if (configuration.type === "number") {
      submit({ type: "number", value: this.numericInput.valueAsNumber });
    } else {
      const width = this.romWidth.valueAsNumber;
      const height = this.romHeight.valueAsNumber;
      if (this.romValues.length !== width * height) {
        throw new Error("ROM draft dimensions do not match its values");
      }
      submit({ type: "rom", width, height, values: [...this.romValues] });
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
