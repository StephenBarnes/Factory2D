import {
  Direction,
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

export class TileInspector {
  private readonly name: HTMLElement;
  private readonly position: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly properties: HTMLElement;
  private readonly id: HTMLElement;
  private readonly orientationRow: HTMLElement;
  private readonly orientation: HTMLElement;
  private readonly movement: HTMLElement;
  private readonly weldable: HTMLElement;
  private readonly welds: HTMLElement;
  private readonly circuitRow: HTMLElement;
  private readonly circuit: HTMLElement;
  private readonly chargeRow: HTMLElement;
  private readonly charge: HTMLElement;
  private readonly magnetic: HTMLElement;
  private readonly attractionRow: HTMLElement;
  private readonly attraction: HTMLElement;
  private lastX = -2;
  private lastY = -2;
  private lastRevision = -1;

  constructor(
    root: HTMLElement,
    private readonly world: World,
  ) {
    this.name = requiredDescendant(root, "[data-inspector-name]");
    this.position = requiredDescendant(root, "[data-inspector-position]");
    this.hint = requiredDescendant(root, "[data-inspector-hint]");
    this.properties = requiredDescendant(root, "[data-inspector-properties]");
    this.id = requiredDescendant(root, "[data-inspector-id]");
    this.orientationRow = requiredDescendant(root, "[data-inspector-orientation-row]");
    this.orientation = requiredDescendant(root, "[data-inspector-orientation]");
    this.movement = requiredDescendant(root, "[data-inspector-movement]");
    this.weldable = requiredDescendant(root, "[data-inspector-weldable]");
    this.welds = requiredDescendant(root, "[data-inspector-welds]");
    this.circuitRow = requiredDescendant(root, "[data-inspector-circuit-row]");
    this.circuit = requiredDescendant(root, "[data-inspector-circuit]");
    this.chargeRow = requiredDescendant(root, "[data-inspector-charge-row]");
    this.charge = requiredDescendant(root, "[data-inspector-charge]");
    this.magnetic = requiredDescendant(root, "[data-inspector-magnetic]");
    this.attractionRow = requiredDescendant(root, "[data-inspector-attraction-row]");
    this.attraction = requiredDescendant(root, "[data-inspector-attraction]");
  }

  update(position: GridPosition | null): void {
    const x = position?.x ?? -1;
    const y = position?.y ?? -1;
    if (x === this.lastX && y === this.lastY && this.world.revision === this.lastRevision) {
      return;
    }
    this.lastX = x;
    this.lastY = y;
    this.lastRevision = this.world.revision;

    if (position === null) {
      this.showMessage("NO CELL SELECTED", "X --   Y --", "Move the pointer over the grid.");
      return;
    }

    const positionLabel = `X ${position.x.toString().padStart(2, "0")}   Y ${position.y.toString().padStart(2, "0")}`;
    const kind = this.world.kindAt(position.x, position.y);
    if (kind === TileKind.Empty) {
      this.showMessage("EMPTY", positionLabel, "No component occupies this cell.");
      return;
    }

    const definition = TILE_DEFINITIONS[kind];
    const orientation = this.world.orientationAt(position.x, position.y);
    this.name.textContent = definition.name.toUpperCase();
    this.position.textContent = positionLabel;
    this.hint.hidden = true;
    this.properties.hidden = false;
    this.id.textContent = `#${this.world.idAt(position.x, position.y).toString().padStart(4, "0")}`;
    this.movement.textContent = definition.affectedByGravity
      ? definition.slidesDiagonally ? "GRAVITY + DIAGONAL" : "GRAVITY"
      : "FIXED";
    this.magnetic.textContent = definition.magnetic ? "YES" : "NO";
    this.orientationRow.hidden = !definition.usesOrientation;
    this.orientation.textContent = DIRECTION_NAMES[orientation];
    this.attractionRow.hidden = definition.attractionRange === 0;
    if (definition.attractionRange > 0) {
      this.attraction.textContent = `${DIRECTION_NAMES[orientation]} · ${definition.attractionRange} CELL`;
    }
    const hasCircuit = definition.circuitPorts !== 0;
    this.circuitRow.hidden = !hasCircuit;
    this.chargeRow.hidden = !hasCircuit;
    if (hasCircuit) {
      const charge = this.world.chargeAt(position.x, position.y);
      this.charge.textContent = charge < 0
        ? "-1 · NEGATIVE"
        : charge > 0 ? "+1 · POSITIVE" : "0 · NEUTRAL";
    }

    let weldableDirections = "";
    let weldableSideCount = 0;
    let weldedDirections = "";
    let circuitDirections = "";
    for (const direction of DIRECTIONS) {
      const sideIsWeldable = (definition.weldableSides & (1 << direction)) !== 0 &&
        (!definition.excludesFacingWeld || direction !== orientation);
      if (sideIsWeldable) {
        weldableSideCount += 1;
        weldableDirections = appendDirection(weldableDirections, direction);
      }

      const neighborX = position.x + DIRECTION_X[direction];
      const neighborY = position.y + DIRECTION_Y[direction];
      if (
        neighborX >= 0 && neighborX < this.world.width &&
        neighborY >= 0 && neighborY < this.world.height &&
        this.world.isWelded(position.x, position.y, neighborX, neighborY)
      ) {
        weldedDirections = appendDirection(weldedDirections, direction);
      }
      const cellIndex = position.y * this.world.width + position.x;
      if (this.world.hasCircuitConnectionAtIndex(cellIndex, direction)) {
        circuitDirections = appendDirection(circuitDirections, direction);
      }
    }
    this.weldable.textContent = weldableSideCount === DIRECTIONS.length
      ? "ALL"
      : weldableDirections || "NONE";
    this.welds.textContent = weldedDirections || "NONE";
    this.circuit.textContent = circuitDirections || "ISOLATED";
  }

  private showMessage(name: string, position: string, message: string): void {
    this.name.textContent = name;
    this.position.textContent = position;
    this.hint.textContent = message;
    this.hint.hidden = false;
    this.properties.hidden = true;
  }
}
