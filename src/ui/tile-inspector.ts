import { furnaceRecipeFor } from "../simulation/furnace";
import {
  Direction,
  orientedSides,
  TILE_DEFINITIONS,
  TileKind,
} from "../simulation/tile";
import type { World } from "../simulation/world";

interface GridPosition {
  readonly x: number;
  readonly y: number;
}

const DIRECTIONS = [
  Direction.Up,
  Direction.Right,
  Direction.Down,
  Direction.Left,
] as const;

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

function appendDirection(current: string, direction: Direction): string {
  const separator = current.length === 0 ? "" : " / ";
  return `${current}${separator}${DIRECTION_NAMES[direction]}`;
}

function formatCharge(charge: number): string {
  return charge < 0
    ? "-1 · NEGATIVE"
    : charge > 0 ? "+1 · POSITIVE" : "0 · NEUTRAL";
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


export class TileInspector {
  private readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly position: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly properties: HTMLElement;
  private readonly paletteDetails: HTMLElement;
  private readonly paletteDescription: HTMLElement;
  private readonly palettePrice: HTMLElement;
  private readonly paletteShortcut: HTMLElement;
  private readonly toolDetails: HTMLElement;
  private readonly toolDescription: HTMLElement;
  private readonly toolControls: HTMLElement;
  private readonly orientationRow: HTMLElement;
  private readonly orientation: HTMLElement;
  private readonly furnaceRow: HTMLElement;
  private readonly furnace: HTMLElement;
  private readonly circuitRow: HTMLElement;
  private readonly circuit: HTMLElement;
  private readonly chargeRow: HTMLElement;
  private readonly charge: HTMLElement;
  private readonly attractionRow: HTMLElement;
  private readonly attraction: HTMLElement;
  private lastX = -2;
  private lastY = -2;
  private lastRevision = -1;
  private showingReference = false;

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
    this.palettePrice = requiredDescendant(root, "[data-inspector-palette-price]");
    this.paletteShortcut = requiredDescendant(root, "[data-inspector-palette-shortcut]");
    this.toolDetails = requiredDescendant(root, "[data-inspector-tool]");
    this.toolDescription = requiredDescendant(root, "[data-inspector-tool-description]");
    this.toolControls = requiredDescendant(root, "[data-inspector-tool-controls]");
    this.orientationRow = requiredDescendant(root, "[data-inspector-orientation-row]");
    this.orientation = requiredDescendant(root, "[data-inspector-orientation]");
    this.furnaceRow = requiredDescendant(root, "[data-inspector-furnace-row]");
    this.furnace = requiredDescendant(root, "[data-inspector-furnace]");
    this.circuitRow = requiredDescendant(root, "[data-inspector-circuit-row]");
    this.circuit = requiredDescendant(root, "[data-inspector-circuit]");
    this.chargeRow = requiredDescendant(root, "[data-inspector-charge-row]");
    this.charge = requiredDescendant(root, "[data-inspector-charge]");
    this.attractionRow = requiredDescendant(root, "[data-inspector-attraction-row]");
    this.attraction = requiredDescendant(root, "[data-inspector-attraction]");
  }

  showPalette(kind: TileKind, price: number | null, shortcut: string | null): void {
    const definition = TILE_DEFINITIONS[kind];
    const palette = definition.palette;
    if (palette === null) {
      throw new Error(`${definition.name} is missing palette metadata`);
    }

    this.showingReference = true;
    this.root.classList.remove("tile-inspector-hidden");
    this.root.setAttribute("aria-hidden", "false");
    this.name.textContent = definition.name.toUpperCase();
    this.position.textContent = "PALETTE COMPONENT";
    this.hint.hidden = true;
    this.properties.hidden = true;
    this.toolDetails.hidden = true;
    this.paletteDetails.hidden = false;
    this.paletteDescription.textContent = palette.description;
    this.palettePrice.textContent = price === null ? "UNPRICED" : String(price);
    this.paletteShortcut.textContent = shortcut ?? "NONE";
  }

  showTool(name: string, description: string, controls: string): void {
    this.showingReference = true;
    this.root.classList.remove("tile-inspector-hidden");
    this.root.setAttribute("aria-hidden", "false");
    this.name.textContent = name.toUpperCase();
    this.position.textContent = "PALETTE TOOL";
    this.hint.hidden = true;
    this.properties.hidden = true;
    this.paletteDetails.hidden = true;
    this.toolDetails.hidden = false;
    this.toolDescription.textContent = description;
    this.toolControls.textContent = controls;
  }

  update(position: GridPosition | null): void {
    const wasShowingReference = this.showingReference;
    this.showingReference = false;
    this.paletteDetails.hidden = true;
    this.toolDetails.hidden = true;
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
    this.orientationRow.hidden = !definition.usesOrientation;
    this.orientation.textContent = DIRECTION_NAMES[orientation];
    this.attractionRow.hidden = definition.attractionRange === 0;
    if (definition.attractionRange > 0) {
      this.attraction.textContent = `${DIRECTION_NAMES[orientation]} · ${definition.attractionRange} CELL`;
    }
    this.furnaceRow.hidden = kind !== TileKind.Furnace;
    if (kind === TileKind.Furnace) {
      const targetX = position.x + DIRECTION_X[orientation];
      const targetY = position.y + DIRECTION_Y[orientation];
      const targetKind = targetX >= 0 &&
          targetX < this.world.width &&
          targetY >= 0 &&
          targetY < this.world.height
        ? this.world.kindAt(targetX, targetY)
        : TileKind.Empty;
      const recipe = furnaceRecipeFor(targetKind);
      if (recipe === undefined) {
        this.furnace.textContent = "IDLE · NO BAKEABLE TARGET";
      } else {
        const progress = this.world.furnaceProgressAt(position.x, position.y);
        const status = progress === 0
          ? "READY"
          : this.world.chargeAt(position.x, position.y) === 1 ? "BAKING" : "PAUSED";
        this.furnace.textContent =
          `${status} · ${TILE_DEFINITIONS[recipe.input].name.toUpperCase()} → ` +
          `${TILE_DEFINITIONS[recipe.output].name.toUpperCase()} · ` +
          `${progress}/${recipe.bakeTime} TICKS`;
      }
    }
    const hasCircuit = definition.circuitPorts !== 0;
    this.circuitRow.hidden = !hasCircuit;
    this.chargeRow.hidden = !hasCircuit;
    if (hasCircuit) {
      if (kind === TileKind.WireCrossing) {
        const horizontal = this.world.chargeAtPort(
          position.x,
          position.y,
          Direction.Left,
        );
        const vertical = this.world.chargeAtPort(
          position.x,
          position.y,
          Direction.Up,
        );
        this.charge.textContent =
          `H ${formatCharge(horizontal)} / V ${formatCharge(vertical)}`;
      } else {
        const chargeLabel = formatCharge(this.world.chargeAt(position.x, position.y));
        this.charge.textContent = definition.circuitInputPorts !== 0
          ? `OUTPUT ${chargeLabel}`
          : chargeLabel;
      }
    }

    const cellIndex = position.y * this.world.width + position.x;
    const circuitInputSides = orientedSides(definition.circuitInputPorts, orientation);
    const circuitOutputSides = orientedSides(definition.circuitOutputPorts, orientation);

    let circuitInputStates = "";
    let circuitOutputStates = "";

    let circuitDirections = "";
    for (const direction of DIRECTIONS) {
      const circuitConnected = this.world.hasCircuitConnectionAtIndex(cellIndex, direction);
      if (circuitConnected) {
        circuitDirections = appendDirection(circuitDirections, direction);
      }
      if (
        kind !== TileKind.ChargeSensor &&
        (circuitInputSides & (1 << direction)) !== 0
      ) {
        const separator = circuitInputStates.length === 0 ? "" : " / ";
        const state = circuitConnected ? "CONNECTED" : "ISOLATED";
        circuitInputStates += `${separator}${DIRECTION_NAMES[direction]} ${state}`;
      }
      if ((circuitOutputSides & (1 << direction)) !== 0) {
        const separator = circuitOutputStates.length === 0 ? "" : " / ";
        const state = circuitConnected ? "CONNECTED" : "ISOLATED";
        circuitOutputStates += `${separator}${DIRECTION_NAMES[direction]} ${state}`;
      }
    }
    if (kind === TileKind.ChargeSensor) {
      this.circuit.textContent =
        `SENSE ${DIRECTION_NAMES[orientation]} (NO WELD) · OUT ${circuitOutputStates}`;
    } else if (definition.circuitInputPorts !== 0) {
      this.circuit.textContent =
        `IN ${circuitInputStates} · OUT ${circuitOutputStates}`;
    } else {
      this.circuit.textContent = circuitDirections || "ISOLATED";
    }
  }

  private showMessage(name: string, position: string, message: string): void {
    this.name.textContent = name;
    this.position.textContent = position;
    this.hint.textContent = message;
    this.hint.hidden = false;
    this.paletteDetails.hidden = true;
    this.toolDetails.hidden = true;
    this.properties.hidden = true;
  }
}
