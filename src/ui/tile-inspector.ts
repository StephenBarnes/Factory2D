import { componentConfigurationForKind } from "../simulation/configurable-components";
import { furnaceNeighborsPresent, isProcessingMachine, processingRecipeFor } from "../simulation/furnace";
import {
  Direction,
  PaletteCategory,
  TILE_DEFINITIONS,
  TileKind,
} from "../simulation/tile";
import type { World } from "../simulation/world";

interface GridPosition {
  readonly x: number;
  readonly y: number;
}

export interface InspectorComponentReference {
  readonly price: number | null;
  readonly shortcut: string | null;
}


const DIRECTION_NAMES: Readonly<Record<Direction, string>> = {
  [Direction.Up]: "UP",
  [Direction.Right]: "RIGHT",
  [Direction.Down]: "DOWN",
  [Direction.Left]: "LEFT",
};

const DIRECTION_X: Readonly<Record<Direction, number>> = {
  [Direction.Up]: 0,
  [Direction.Right]: 1,
  [Direction.Down]: 0,
  [Direction.Left]: -1,
};

const DIRECTION_Y: Readonly<Record<Direction, number>> = {
  [Direction.Up]: -1,
  [Direction.Right]: 0,
  [Direction.Down]: 1,
  [Direction.Left]: 0,
};

function requiredDescendant<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required tile inspector element ${selector}`);
  }
  return element;
}

function descriptionFor(kind: TileKind): string {
  const definition = TILE_DEFINITIONS[kind];
  if (definition.palette !== null) {
    return definition.palette.description;
  }
  if (kind === TileKind.PistonBase) {
    return "Extended piston base; its rear sides retain the piston's welds and circuit connections.";
  }
  if (kind === TileKind.PistonArm) {
    return "Extended piston arm; its head carries the piston's forward weld.";
  }
  throw new Error(`${definition.name} is missing inspector description metadata`);
}

function twoInputGateOutput(kind: TileKind, input1: number, input2: number): number {
  switch (kind) {
    case TileKind.Inverter: return Math.sign(-input1 - input2);
    case TileKind.Combiner: return Math.sign(input1 + input2);
    case TileKind.Rectifier: return input1 + input2 > 0 ? 1 : 0;
    case TileKind.Multiplier: return input1 * input2;
    case TileKind.Subtractor: return Math.sign(input1 - input2);
    case TileKind.Selector: return input1 === 1 ? input2 : 0;
    case TileKind.Equality: return input1 === input2 ? 1 : 0;
    case TileKind.Minimum: return Math.min(input1, input2);
    case TileKind.Maximum: return Math.max(input1, input2);
    default: throw new Error(`${TILE_DEFINITIONS[kind].name} is missing a gate truth table`);
  }
}

function gateTruthTable(kind: TileKind): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "inspector-truth-table";
  const caption = table.createCaption();
  caption.textContent = kind === TileKind.Selector
    ? "Input 1: rear control; input 2: left signal. Right disconnected (0)."
    : kind === TileKind.Subtractor
      ? "Input 1: rear; input 2: left. Right disconnected (0)."
      : "Two connected inputs; third input disconnected.";
  const header = table.createTHead().insertRow();
  for (const label of ["2 ↓ / 1 →", "−1", "0", "+1"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    header.append(cell);
  }
  const body = table.createTBody();
  for (let input2 = -1; input2 <= 1; input2 += 1) {
    const row = body.insertRow();
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.textContent = input2 > 0 ? "+1" : String(input2);
    row.append(heading);
    for (let input1 = -1; input1 <= 1; input1 += 1) {
      const output = twoInputGateOutput(kind, input1, input2);
      const cell = row.insertCell();
      cell.textContent = output > 0 ? "+1" : String(output);
      cell.dataset.charge = String(output);
    }
  }
  return table;
}


export class TileInspector {
  private readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly position: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly properties: HTMLElement;
  private readonly paletteDetails: HTMLElement;
  private readonly paletteDescription: HTMLElement;
  private readonly componentReference: HTMLElement;
  private readonly price: HTMLElement;
  private readonly shortcut: HTMLElement;
  private readonly toolDetails: HTMLElement;
  private readonly toolDescription: HTMLElement;
  private readonly toolControls: HTMLElement;
  private readonly assemblerRow: HTMLElement;
  private readonly assembler: HTMLElement;
  private readonly furnaceRow: HTMLElement;
  private readonly furnaceLabel: HTMLElement;
  private readonly configurationRow: HTMLElement;
  private readonly configuration: HTMLElement;
  private readonly configurationControlsRow: HTMLElement;
  private readonly configurationControls: HTMLElement;
  private readonly furnace: HTMLElement;
  private readonly attractionRow: HTMLElement;
  private readonly attraction: HTMLElement;
  private lastX = -2;
  private lastY = -2;
  private lastRevision = -1;
  private showingReference = false;
  private referenceKind: TileKind | null = null;

  constructor(
    root: HTMLElement,
    private readonly world: World,
  ) {
    this.root = root;
    this.name = requiredDescendant(root, "[data-inspector-name]");
    this.position = requiredDescendant(root, "[data-inspector-position]");
    this.hint = requiredDescendant(root, "[data-inspector-hint]");
    this.properties = requiredDescendant(root, "[data-inspector-properties]");
    this.paletteDetails = requiredDescendant(root, "[data-inspector-palette]");
    this.paletteDescription = requiredDescendant(root, "[data-inspector-palette-description]");
    this.componentReference = requiredDescendant(root, "[data-inspector-component-reference]");
    this.price = requiredDescendant(root, "[data-inspector-price]");
    this.shortcut = requiredDescendant(root, "[data-inspector-shortcut]");
    this.toolDetails = requiredDescendant(root, "[data-inspector-tool]");
    this.toolDescription = requiredDescendant(root, "[data-inspector-tool-description]");
    this.toolControls = requiredDescendant(root, "[data-inspector-tool-controls]");
    this.assemblerRow = requiredDescendant(root, "[data-inspector-assembler-row]");
    this.assembler = requiredDescendant(root, "[data-inspector-assembler]");
    this.furnaceRow = requiredDescendant(root, "[data-inspector-furnace-row]");
    this.furnaceLabel = requiredDescendant(this.furnaceRow, "dt");
    this.configurationRow = requiredDescendant(root, "[data-inspector-configuration-row]");
    this.configuration = requiredDescendant(root, "[data-inspector-configuration]");
    this.configurationControlsRow = requiredDescendant(
      root,
      "[data-inspector-configuration-controls-row]",
    );
    this.configurationControls = requiredDescendant(
      root,
      "[data-inspector-configuration-controls]",
    );
    this.furnace = requiredDescendant(root, "[data-inspector-furnace]");
    this.attractionRow = requiredDescendant(root, "[data-inspector-attraction-row]");
    this.attraction = requiredDescendant(root, "[data-inspector-attraction]");
  }

  showPalette(kind: TileKind, reference: InspectorComponentReference): void {
    const definition = TILE_DEFINITIONS[kind];
    const palette = definition.palette;
    if (palette === null) {
      throw new Error(`${definition.name} is missing palette metadata`);
    }

    this.showingReference = true;
    this.root.classList.remove("tile-inspector-hidden");
    this.root.classList.add("tile-inspector-reference");
    this.root.setAttribute("aria-hidden", "false");
    this.name.textContent = definition.name.toUpperCase();
    this.position.hidden = true;
    this.showComponentReference(reference);
    this.hint.hidden = true;
    this.properties.hidden = true;
    this.toolDetails.hidden = true;
    this.paletteDetails.hidden = false;
    if (this.referenceKind === kind) {
      return;
    }
    this.referenceKind = kind;
    this.paletteDescription.replaceChildren(...[
      palette.description,
      ...palette.extendedDescription,
    ].map((text) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      return paragraph;
    }));
    if (palette.category === PaletteCategory.CircuitGates) {
      this.paletteDescription.append(gateTruthTable(kind));
    }
  }

  showTool(name: string, description: string, controls: string): void {
    this.showingReference = true;
    this.root.classList.remove("tile-inspector-hidden");
    this.root.classList.remove("tile-inspector-reference");
    this.root.setAttribute("aria-hidden", "false");
    this.name.textContent = name.toUpperCase();
    this.position.hidden = false;
    this.position.textContent = "PALETTE TOOL";
    this.showComponentReference(null);
    this.hint.hidden = true;
    this.properties.hidden = true;
    this.paletteDetails.hidden = true;
    this.toolDetails.hidden = false;
    this.toolDescription.textContent = description;
    this.toolControls.textContent = controls;
  }

  update(
    position: GridPosition | null,
    reference: InspectorComponentReference | null,
  ): void {
    const wasShowingReference = this.showingReference;
    this.showingReference = false;
    this.root.classList.remove("tile-inspector-reference");
    this.paletteDetails.hidden = true;
    this.toolDetails.hidden = true;
    this.position.hidden = false;
    const x = position?.x ?? -1;
    const y = position?.y ?? -1;
    const kind = position === null ? TileKind.Empty : this.world.kindAt(x, y);
    const hidden = kind === TileKind.Empty;
    this.root.classList.toggle("tile-inspector-hidden", hidden);
    this.root.setAttribute("aria-hidden", String(hidden));
    if (
      !wasShowingReference &&
      x === this.lastX &&
      y === this.lastY &&
      this.world.revision === this.lastRevision
    ) {
      return;
    }
    this.lastX = x;
    this.lastY = y;
    this.lastRevision = this.world.revision;

    if (position === null) {
      this.showMessage("NO CELL SELECTED", "X --   Y --", "Move the pointer over the grid.");
      return;
    }

    const positionLabel =
      `X ${position.x.toString().padStart(2, "0")}   ` +
      `Y ${position.y.toString().padStart(2, "0")}`;
    if (kind === TileKind.Empty) {
      this.showMessage("EMPTY", positionLabel, "No component occupies this cell.");
      return;
    }

    const definition = TILE_DEFINITIONS[kind];
    const orientation = this.world.orientationAt(position.x, position.y);
    const id = this.world.idAt(position.x, position.y).toString().padStart(4, "0");
    this.name.textContent = definition.name.toUpperCase();
    this.position.textContent = `${positionLabel}   ID #${id}`;
    this.hint.textContent = descriptionFor(kind);
    this.hint.hidden = false;
    this.properties.hidden = false;
    this.showComponentReference(reference);
    const componentConfiguration = componentConfigurationForKind(kind);
    const componentState = this.world.componentStateSnapshotAt(position.x, position.y);
    this.configurationRow.hidden = componentConfiguration === null;
    this.configurationControlsRow.hidden = componentConfiguration === null;
    if (componentState !== null && componentConfiguration !== null) {
      if (componentState.type === "delay") {
        this.configuration.textContent =
          `${componentState.length} TICKS · CURSOR ${componentState.cursor + 1}`;
      } else if (componentState.type === "discard") {
        this.configuration.textContent =
          `SUPPRESSED ${componentState.discarded} / ${componentState.length} TICKS` +
          (componentState.discarded === componentState.length ? " · PASS-THROUGH" : "");
      } else if (componentState.type === "counter") {
        this.configuration.textContent =
          `COUNT ${componentState.count} · THRESHOLD ${componentState.threshold}`;
      } else if (componentState.type === "rom") {
        this.configuration.textContent =
          `${componentState.width} × ${componentState.height} · CELL ${componentState.cursor + 1}`;
      } else if (componentState.type === "lut") {
        this.configuration.textContent =
          "3 × 3 TRUTH TABLE · LEFT = COLUMN · REAR = ROW · AXES −1, 0, +1";
      } else if (componentState.type === "checker") {
        const valueCount = componentState.width * componentState.height;
        const status = componentState.failed
          ? `FAILED AT ${componentState.cursor + 1}`
          : componentState.cursor === 0
            ? "WAITING"
            : componentState.cursor === valueCount
              ? "PASSED"
              : `MATCHED ${componentState.cursor}`;
        this.configuration.textContent =
          `${componentState.width} × ${componentState.height} · ${valueCount} VALUES · ${status}` +
          (componentState.ignoreZeros ? " · IGNORE ZEROS" : "");
      } else if (componentState.type === "array") {
        const inner = componentState.world;
        let occupied = 0;
        for (let index = 0; index < inner.cellCount; index += 1) {
          if (inner.kindAtIndex(index) !== TileKind.Empty) {
            occupied += 1;
          }
        }
        this.configuration.textContent =
          `${inner.width} × ${inner.height} · ${occupied} COMPONENT${occupied === 1 ? "" : "S"}` +
          (componentState.description === "" ? "" : ` · "${componentState.description}"`);
      } else if (componentState.type === "monitor" || componentState.type === "grapher") {
        this.configuration.textContent = componentState.label === ""
          ? "UNNAMED SIGNAL"
          : `SIGNAL "${componentState.label}"`;
      } else {
        throw new Error(`${definition.name} has no configuration presentation`);
      }
      this.configurationControls.textContent = componentConfiguration.type === "number"
        ? "E EDIT · SHIFT + WHEEL ADJUST"
        : componentConfiguration.type === "array"
          ? "E CONFIGURE · ENTER OPEN"
          : "E EDIT";
    }
    this.attractionRow.hidden = definition.attractionRange === 0;
    if (definition.attractionRange > 0) {
      this.attraction.textContent = `${DIRECTION_NAMES[orientation]} · ${definition.attractionRange} CELL`;
    }
    this.assemblerRow.hidden = kind !== TileKind.Assembler;
    if (kind === TileKind.Assembler) {
      const pending = componentState?.type === "assembler" ? componentState.pending : [];
      this.assembler.textContent = pending.length === 0
        ? "IDLE · CONSUMES A MATCHING BODY AHEAD"
        : `${pending.length} QUEUED · ` +
          pending.map((output) => TILE_DEFINITIONS[output.kind].name.toUpperCase()).join(", ");
    }
    const processingMachine = isProcessingMachine(kind);
    this.furnaceRow.hidden = !processingMachine;
    if (processingMachine) {
      const isFurnace = kind === TileKind.Furnace;
      const isDrill = kind === TileKind.Drill;
      this.furnaceLabel.textContent = isFurnace ? "BAKE" : "PROCESS";
      const targetX = position.x + DIRECTION_X[orientation];
      const targetY = position.y + DIRECTION_Y[orientation];
      const targetKind = targetX >= 0 &&
          targetX < this.world.width &&
          targetY >= 0 &&
          targetY < this.world.height
        ? this.world.kindAt(targetX, targetY)
        : TileKind.Empty;
      const recipe = processingRecipeFor(kind, targetKind);
      if (recipe === undefined) {
        this.furnace.textContent = isFurnace
          ? "IDLE · NO BAKEABLE TARGET"
          : isDrill ? "IDLE · NO DESTRUCTIBLE TARGET" : "IDLE · NO GRINDABLE TARGET";
      } else {
        const progress = this.world.furnaceProgressAt(position.x, position.y);
        const status = recipe.requiredNeighbors !== undefined && !furnaceNeighborsPresent(
          this.world, targetY * this.world.width + targetX, recipe,
        )
          ? `WAITING FOR ${recipe.requiredNeighbors.map((kind) => TILE_DEFINITIONS[kind].name.toUpperCase()).join(" + ")} BESIDE TARGET`
          : progress === 0
            ? "READY"
            : this.world.chargeAtPort(position.x, position.y, ((orientation + 2) & 3) as Direction) === 1
              ? isFurnace ? "BAKING" : isDrill ? "DRILLING" : "PROCESSING"
              : "PAUSED";
        this.furnace.textContent =
          `${status} · ${TILE_DEFINITIONS[recipe.input].name.toUpperCase()} → ` +
          `${isDrill ? "DESTROYED" : TILE_DEFINITIONS[recipe.output].name.toUpperCase()} · ` +
          `${progress}/${recipe.bakeTime} TICKS`;
      }
    }
  }

  private showComponentReference(reference: InspectorComponentReference | null): void {
    this.componentReference.hidden = reference === null ||
      (reference.price === null && reference.shortcut === null);
    if (reference === null) {
      return;
    }
    this.price.hidden = reference.price === null;
    this.price.textContent = reference.price === null ? "" : `${reference.price} ⚙`;
    this.shortcut.hidden = reference.shortcut === null;
    this.shortcut.textContent = reference.shortcut ?? "";
  }

  private showMessage(name: string, position: string, message: string): void {
    this.name.textContent = name;
    this.position.textContent = position;
    this.position.hidden = false;
    this.showComponentReference(null);
    this.hint.textContent = message;
    this.hint.hidden = false;
    this.paletteDetails.hidden = true;
    this.toolDetails.hidden = true;
    this.properties.hidden = true;
  }
}
