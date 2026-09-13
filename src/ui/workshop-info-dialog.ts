import type {
  SandboxPuzzleComponentProperty,
  SandboxPuzzleProperties,
} from "../game/sandbox-puzzle-authoring";
import { PUZZLE_GROUPS } from "../game/puzzle-groups";
import { parsePuzzleDifficulty, PUZZLE_DIFFICULTIES } from "../game/puzzle-difficulty";
import {
  DEFAULT_PUZZLE_CYCLE_LIMIT,
  MAX_PUZZLE_CYCLE_LIMIT,
} from "../game/puzzle-format";
import {
  MAX_BOARD_HEIGHT,
  MAX_BOARD_WIDTH,
  MIN_BOARD_HEIGHT,
  MIN_BOARD_WIDTH,
} from "../simulation/board-export";
import { TILE_DEFINITIONS, TILE_KINDS, type TileKind } from "../simulation/tile";
import { PALETTE_CATEGORIES } from "./component-palette";

export interface WorkshopInformation {
  readonly name: string;
  readonly description: string;
  readonly goal: string | null;
}

interface ComponentControls {
  readonly checkbox: HTMLInputElement;
  readonly price: HTMLInputElement;
}

export class WorkshopInfoDialog {
  private readonly form: HTMLFormElement;
  private readonly status: HTMLElement;
  private readonly staticContent: HTMLElement;
  private readonly propertiesContent: HTMLElement;
  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private readonly goalPanel: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly idInput: HTMLInputElement;
  private readonly groupSelect: HTMLSelectElement;
  private readonly orderInput: HTMLInputElement;
  private readonly difficultySelect: HTMLSelectElement;
  private readonly nameInput: HTMLInputElement;
  private readonly descriptionInput: HTMLTextAreaElement;
  private readonly goalInput: HTMLInputElement;
  private readonly cycleLimitInput: HTMLInputElement;
  private readonly widthInput: HTMLInputElement;
  private readonly heightInput: HTMLInputElement;
  private readonly componentControls = new Map<TileKind, ComponentControls>();
  private readonly saveButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private saveProperties: ((properties: SandboxPuzzleProperties) => void) | null = null;

  constructor(private readonly dialog: HTMLDialogElement) {
    this.form = requiredDescendant(dialog, "[data-workshop-info-form]");
    this.status = requiredDescendant(dialog, "[data-workshop-info-status]");
    this.staticContent = requiredDescendant(dialog, "[data-workshop-info-static]");
    this.propertiesContent = requiredDescendant(dialog, "[data-workshop-properties]");
    this.title = requiredDescendant(dialog, "[data-workshop-info-title]");
    this.description = requiredDescendant(dialog, "[data-workshop-info-description]");
    this.goalPanel = requiredDescendant(dialog, "[data-workshop-info-goal-panel]");
    this.goal = requiredDescendant(dialog, "[data-workshop-info-goal]");
    this.idInput = requiredDescendant(dialog, "[data-workshop-properties-id]");
    this.groupSelect = requiredDescendant(dialog, "[data-workshop-properties-group]");
    this.orderInput = requiredDescendant(dialog, "[data-workshop-properties-order]");
    this.difficultySelect = requiredDescendant(dialog, "[data-workshop-properties-difficulty]");
    this.nameInput = requiredDescendant(dialog, "[data-workshop-properties-name]");
    this.descriptionInput = requiredDescendant(dialog, "[data-workshop-properties-description]");
    this.goalInput = requiredDescendant(dialog, "[data-workshop-properties-goal]");
    this.cycleLimitInput = requiredDescendant(
      dialog,
      "[data-workshop-properties-cycle-limit]",
    );
    this.widthInput = requiredDescendant(dialog, "[data-workshop-properties-width]");
    this.heightInput = requiredDescendant(dialog, "[data-workshop-properties-height]");
    this.saveButton = requiredDescendant(dialog, "[data-workshop-properties-save]");
    this.closeButton = requiredDescendant(dialog, "[data-workshop-info-close]");

    this.widthInput.min = String(MIN_BOARD_WIDTH);
    this.widthInput.max = String(MAX_BOARD_WIDTH);
    this.heightInput.min = String(MIN_BOARD_HEIGHT);
    this.heightInput.max = String(MAX_BOARD_HEIGHT);
    this.cycleLimitInput.max = String(MAX_PUZZLE_CYCLE_LIMIT);
    this.cycleLimitInput.placeholder = `Default: ${DEFAULT_PUZZLE_CYCLE_LIMIT}`;
    for (const group of PUZZLE_GROUPS) {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.name;
      this.groupSelect.append(option);
    }
    for (const value of ["tutorial", 1, 2, 3, 4, 5] as const) {
      const rating = PUZZLE_DIFFICULTIES[value];
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `${rating.mark} ${rating.label}`;
      this.difficultySelect.append(option);
    }
    this.buildComponentControls(
      requiredDescendant(dialog, "[data-workshop-properties-components]"),
    );
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitProperties();
    });
    this.closeButton.addEventListener("click", () => this.dialog.close());
  }

  show(information: WorkshopInformation): void {
    this.saveProperties = null;
    this.status.textContent = "WORKSHOP INFORMATION";
    this.staticContent.hidden = false;
    this.propertiesContent.hidden = true;
    this.saveButton.hidden = true;
    this.closeButton.textContent = "CLOSE";
    this.title.textContent = information.name;
    this.description.textContent = information.description;
    this.goalPanel.hidden = information.goal === null;
    this.goal.textContent = information.goal ?? "";
    this.dialog.showModal();
  }

  showProperties(
    properties: SandboxPuzzleProperties,
    onSave: (updated: SandboxPuzzleProperties) => void,
  ): void {
    this.saveProperties = onSave;
    this.status.textContent = "PUZZLE PROPERTIES";
    this.staticContent.hidden = true;
    this.propertiesContent.hidden = false;
    this.saveButton.hidden = false;
    this.closeButton.textContent = "CANCEL";
    this.idInput.value = properties.id;
    this.groupSelect.value = properties.groupId;
    this.orderInput.valueAsNumber = properties.order;
    this.difficultySelect.value = String(properties.difficulty);
    this.nameInput.value = properties.name;
    this.descriptionInput.value = properties.description;
    this.goalInput.value = properties.goal;
    this.cycleLimitInput.value = properties.cycleLimit === null
      ? ""
      : String(properties.cycleLimit);
    this.widthInput.valueAsNumber = properties.width;
    this.heightInput.valueAsNumber = properties.height;
    for (const component of properties.components) {
      const controls = this.componentControls.get(component.kind);
      if (controls === undefined) {
        throw new Error(`Missing puzzle property controls for tile kind ${component.kind}`);
      }
      controls.checkbox.checked = component.enabled;
      controls.price.valueAsNumber = component.price;
      controls.price.disabled = !component.enabled;
    }
    this.dialog.showModal();
    this.nameInput.focus();
  }

  close(): void {
    if (this.dialog.open) {
      this.dialog.close();
    }
  }

  private buildComponentControls(container: HTMLElement): void {
    const kinds = TILE_KINDS
      .filter((kind) => TILE_DEFINITIONS[kind].palette !== null)
      .sort((left, right) => {
        const leftPalette = TILE_DEFINITIONS[left].palette;
        const rightPalette = TILE_DEFINITIONS[right].palette;
        if (leftPalette === null || rightPalette === null) {
          throw new Error("Puzzle component palette metadata is missing");
        }
        return leftPalette.category - rightPalette.category ||
          leftPalette.order - rightPalette.order;
      });

    for (const categoryDefinition of PALETTE_CATEGORIES) {
      const categoryKinds = kinds.filter(
        (kind) => TILE_DEFINITIONS[kind].palette?.category === categoryDefinition.category,
      );
      if (categoryKinds.length === 0) {
        continue;
      }

      const section = document.createElement("section");
      section.className = "workshop-properties-component-group";
      const header = document.createElement("div");
      header.className = "workshop-properties-component-group-header";
      const heading = document.createElement("h3");
      heading.textContent = categoryDefinition.label;
      const actions = document.createElement("div");
      const selectAll = document.createElement("button");
      selectAll.type = "button";
      selectAll.textContent = "ALL";
      selectAll.setAttribute("aria-label", `Enable all ${categoryDefinition.label}`);
      selectAll.addEventListener("click", () => {
        this.setComponentsEnabled(categoryKinds, true);
      });
      const selectNone = document.createElement("button");
      selectNone.type = "button";
      selectNone.textContent = "NONE";
      selectNone.setAttribute("aria-label", `Disable all ${categoryDefinition.label}`);
      selectNone.addEventListener("click", () => {
        this.setComponentsEnabled(categoryKinds, false);
      });
      actions.append(selectAll, selectNone);
      header.append(heading, actions);

      const rows = document.createElement("div");
      rows.className = "workshop-properties-component-rows";
      for (const kind of categoryKinds) {
        const row = document.createElement("div");
        row.className = "workshop-properties-component";

        const enabledLabel = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        const name = document.createElement("span");
        name.textContent = TILE_DEFINITIONS[kind].name;
        enabledLabel.append(checkbox, name);

        const priceLabel = document.createElement("label");
        priceLabel.className = "workshop-properties-price";
        const priceText = document.createElement("span");
        priceText.textContent = "PRICE";
        const price = document.createElement("input");
        price.type = "number";
        price.setAttribute("aria-label", `${TILE_DEFINITIONS[kind].name} price`);
        price.min = "0";
        price.max = String(Number.MAX_SAFE_INTEGER);
        price.step = "1";
        price.required = true;
        priceLabel.append(priceText, price);
        checkbox.addEventListener("change", () => {
          price.disabled = !checkbox.checked;
        });

        row.append(enabledLabel, priceLabel);
        rows.append(row);
        this.componentControls.set(kind, { checkbox, price });
      }

      section.append(header, rows);
      container.append(section);
    }
  }

  private setComponentsEnabled(kinds: readonly TileKind[], enabled: boolean): void {
    for (const kind of kinds) {
      const controls = this.componentControls.get(kind);
      if (controls === undefined) {
        throw new Error(`Missing puzzle property controls for tile kind ${kind}`);
      }
      controls.checkbox.checked = enabled;
      controls.price.disabled = !enabled;
    }
  }

  private submitProperties(): void {
    if (this.saveProperties === null || !this.form.reportValidity()) {
      return;
    }
    const components: SandboxPuzzleComponentProperty[] = [];
    for (const [kind, controls] of this.componentControls) {
      components.push({
        kind,
        enabled: controls.checkbox.checked,
        price: controls.price.valueAsNumber,
      });
    }
    this.saveProperties({
      width: this.widthInput.valueAsNumber,
      height: this.heightInput.valueAsNumber,
      id: this.idInput.value,
      groupId: this.groupSelect.value,
      order: this.orderInput.valueAsNumber,
      difficulty: parsePuzzleDifficulty(
        this.difficultySelect.value === "tutorial" ? "tutorial" : Number(this.difficultySelect.value),
      ),
      name: this.nameInput.value,
      description: this.descriptionInput.value,
      goal: this.goalInput.value,
      cycleLimit: this.cycleLimitInput.value === ""
        ? null
        : this.cycleLimitInput.valueAsNumber,
      components,
    });
    this.dialog.close();
  }
}

function requiredDescendant<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required workshop information element ${selector}`);
  }
  return element;
}
