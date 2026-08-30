import "./styles.css";

import { CanvasRenderer } from "./render/canvas-renderer";
import {
  cellsOnGridSegment,
  visitCrossedGridEdges,
} from "./render/grid-drag";
import type { GridCell, GridEdge, GridPoint } from "./render/grid-drag";
import { drawTile } from "./render/tile-renderer";
import { Simulation } from "./simulation/simulation";
import { Direction, TileKind } from "./simulation/tile";
import { World } from "./simulation/world";

const MAX_AUTOMATIC_ANIMATION_MS = 250;
const MANUAL_STEP_ANIMATION_MS = 200;

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}

const world = new World(20, 14);
for (let x = 0; x < world.width; x += 1) {
  world.place(x, world.height - 1, TileKind.Platform);
}
for (let x = 3; x <= 7; x += 1) {
  world.place(x, 9, TileKind.Platform);
}
for (let x = 13; x <= 16; x += 1) {
  world.place(x, 11, TileKind.Platform);
}
world.place(5, 3, TileKind.Sand);
world.place(5, 4, TileKind.Sand);
world.place(11, 2, TileKind.Sand);
world.place(15, 5, TileKind.Sand);

const simulation = new Simulation(world);
const baseline = world.clone();
const previousWorld = world.clone();
const canvas = requiredElement<HTMLCanvasElement>("game-canvas");
const renderer = new CanvasRenderer(canvas, world);
const sidebarControls = requiredElement<HTMLElement>("sidebar-controls");
const playButton = requiredElement<HTMLButtonElement>("play-button");
const stepButton = requiredElement<HTMLButtonElement>("step-button");
const resetButton = requiredElement<HTMLButtonElement>("reset-button");
const clearButton = requiredElement<HTMLButtonElement>("clear-button");
const speedSelect = requiredElement<HTMLSelectElement>("speed-select");
const stateLight = requiredElement<HTMLSpanElement>("state-light");
const stateLabel = requiredElement<HTMLSpanElement>("state-label");
const tickCounter = requiredElement<HTMLSpanElement>("tick-counter");
const coordinates = requiredElement<HTMLDivElement>("coordinates");

let selectedKind = TileKind.Sand;
let selectedOrientation = Direction.Up;
let selectedTool: "tile" | "weld" = "tile";
let temporaryWeldActive = false;
let activePointerId: number | null = null;
let activeErase = false;
let lastEditedCell: GridCell | null = null;
let lastPointerGridPoint: GridPoint | null = null;
let hoveredCell: GridCell | null = null;
let hoveredEdge: GridEdge | null = null;
let running = false;
let accumulatedTime = 0;
let previousFrameTime = performance.now();
let animationStartedAt = 0;
let animationDuration = 0;
let renderedTick = -1;

function updateTransportState(): void {
  playButton.textContent = running ? "Ⅱ PAUSE" : "▶ RUN";
  playButton.classList.toggle("running", running);
  stateLight.classList.toggle("running", running);
  stateLabel.textContent = running ? "SIMULATING" : "BUILD MODE";
  stepButton.disabled = running;
}

function setRunning(nextRunning: boolean): void {
  running = nextRunning;
  accumulatedTime = 0;
  updateTransportState();
}

function finishAnimation(): void {
  previousWorld.copyFrom(world);
  animationDuration = 0;
}

function advanceSimulation(duration: number, startedAt = performance.now()): void {
  previousWorld.copyFrom(world);
  simulation.step();
  animationStartedAt = startedAt;
  animationDuration = duration;
}

function easedAnimationProgress(currentTime: number): number {
  if (animationDuration === 0) {
    return 1;
  }
  const progress = Math.min(1, Math.max(0, (currentTime - animationStartedAt) / animationDuration));
  if (progress === 1) {
    animationDuration = 0;
  }
  return progress * progress * (3 - 2 * progress);
}

function refreshPointerHover(): void {
  if (selectedTool === "weld") {
    renderer.setHoverEdge(hoveredEdge);
  } else {
    renderer.setHover(
      hoveredCell,
      selectedKind,
      selectedKind === TileKind.Magnet ? selectedOrientation : Direction.Up,
    );
  }
  coordinates.textContent = hoveredCell === null
    ? "X --   Y --"
    : `X ${hoveredCell.x.toString().padStart(2, "0")}   Y ${hoveredCell.y.toString().padStart(2, "0")}`;
}

function selectTile(kind: TileKind): void {
  selectedKind = kind;
  if (temporaryWeldActive) {
    selectWeldTool();
    return;
  }

  selectedTool = "tile";
  for (const item of sidebarControls.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.classList.toggle("selected", item.dataset.tile === String(kind));
  }
  refreshPointerHover();
}

function renderPalettePreviews(): void {
  for (const preview of sidebarControls.querySelectorAll<HTMLCanvasElement>(".tile-preview")) {
    const kind = Number(preview.dataset.tilePreview) as TileKind;
    const context = preview.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D is not supported by this browser");
    }
    context.clearRect(0, 0, preview.width, preview.height);
    drawTile(
      context,
      0,
      0,
      preview.width,
      kind,
      kind === TileKind.Magnet ? selectedOrientation : Direction.Up,
    );
  }
}

function setSelectedOrientation(orientation: Direction): void {
  selectedOrientation = orientation;
  renderPalettePreviews();
  refreshPointerHover();
}

function selectWeldTool(): void {
  selectedTool = "weld";
  for (const item of sidebarControls.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.classList.toggle("selected", item.dataset.tool === "weld");
  }
  refreshPointerHover();
}

function saveEditedBaseline(): void {
  baseline.copyFrom(world);
  simulation.tick = 0;
  finishAnimation();
}

function editCellLine(from: GridCell, to: GridCell, erase: boolean): void {
  if (running) {
    return;
  }

  const kind = erase ? TileKind.Empty : selectedKind;
  let x = from.x;
  let y = from.y;
  const deltaX = Math.abs(to.x - from.x);
  const deltaY = Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let error = deltaX - deltaY;
  let changed = false;
  const orientation = selectedKind === TileKind.Magnet ? selectedOrientation : Direction.Up;

  while (true) {
    if (
      world.kindAt(x, y) !== kind ||
      (
        kind !== TileKind.Empty &&
        world.orientationAt(x, y) !== orientation
      )
    ) {
      world.place(x, y, kind, orientation);
      changed = true;
    }
    if (x === to.x && y === to.y) {
      break;
    }
    const doubledError = error * 2;
    if (doubledError > -deltaY) {
      error -= deltaY;
      x += stepX;
    }
    if (doubledError < deltaX) {
      error += deltaX;
      y += stepY;
    }
  }

  if (changed) {
    saveEditedBaseline();
  }
}

function editWeld(edge: GridEdge, erase: boolean): void {
  if (!running && world.setWeld(edge.x1, edge.y1, edge.x2, edge.y2, !erase)) {
    saveEditedBaseline();
  }
}

function editWeldSegment(
  from: GridPoint,
  to: GridPoint,
  endpointEdge: GridEdge | null,
  erase: boolean,
): void {
  if (running) {
    return;
  }

  let changed = false;
  visitCrossedGridEdges(from, to, world.width, world.height, (x1, y1, x2, y2) => {
    changed = world.setWeld(x1, y1, x2, y2, !erase) || changed;
  });
  if (endpointEdge !== null) {
    changed = world.setWeld(
      endpointEdge.x1,
      endpointEdge.y1,
      endpointEdge.x2,
      endpointEdge.y2,
      !erase,
    ) || changed;
  }
  if (changed) {
    saveEditedBaseline();
  }
}

sidebarControls.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".palette-item");
  const tileKind = Number(button?.dataset.tile);
  if (
    Number.isInteger(tileKind) &&
    tileKind >= TileKind.Stone &&
    tileKind <= TileKind.Metal
  ) {
    selectTile(tileKind as TileKind);
  } else if (button?.dataset.tool === "weld") {
    selectWeldTool();
  }
});

playButton.addEventListener("click", () => {
  setRunning(!running);
});

stepButton.addEventListener("click", () => {
  advanceSimulation(MANUAL_STEP_ANIMATION_MS);
});

resetButton.addEventListener("click", () => {
  setRunning(false);
  simulation.resetTo(baseline);
  finishAnimation();
});

clearButton.addEventListener("click", () => {
  if (running) {
    return;
  }
  world.clear();
  baseline.copyFrom(world);
  simulation.tick = 0;
  finishAnimation();
});

canvas.addEventListener("pointerdown", (event) => {
  if (running || (event.button !== 0 && event.button !== 2)) {
    return;
  }

  event.preventDefault();
  activePointerId = event.pointerId;
  activeErase = event.button === 2;
  canvas.setPointerCapture(event.pointerId);

  const point = renderer.gridPointFromClientPoint(event.clientX, event.clientY);
  lastPointerGridPoint = point;
  if (selectedTool === "tile") {
    const cell = renderer.cellFromGridPoint(point);
    if (cell !== null) {
      editCellLine(cell, cell, activeErase);
      lastEditedCell = cell;
    }
  } else {
    const edge = renderer.edgeFromGridPoint(point);
    if (edge !== null) {
      editWeld(edge, activeErase);
    }
  }
});

canvas.addEventListener("pointermove", (event) => {
  const point = renderer.gridPointFromClientPoint(event.clientX, event.clientY);
  hoveredCell = renderer.cellFromGridPoint(point);
  hoveredEdge = renderer.edgeFromGridPoint(point);
  refreshPointerHover();

  if (event.pointerId !== activePointerId) {
    return;
  }
  if (lastPointerGridPoint === null) {
    throw new Error("Active pointer is missing its previous grid position");
  }

  if (selectedTool === "tile") {
    const segment = cellsOnGridSegment(
      lastPointerGridPoint,
      point,
      world.width,
      world.height,
    );
    if (segment !== null) {
      editCellLine(lastEditedCell ?? segment.from, segment.to, activeErase);
      lastEditedCell = segment.to;
    }
  } else {
    editWeldSegment(lastPointerGridPoint, point, hoveredEdge, activeErase);
  }
  lastPointerGridPoint = point;
});

function finishPointerEdit(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) {
    return;
  }
  activePointerId = null;
  lastEditedCell = null;
  lastPointerGridPoint = null;
}

canvas.addEventListener("pointerup", finishPointerEdit);
canvas.addEventListener("pointercancel", finishPointerEdit);

canvas.addEventListener("pointerleave", () => {
  hoveredCell = null;
  hoveredEdge = null;
  refreshPointerHover();
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Control") {
    if (!event.repeat && selectedTool === "tile") {
      temporaryWeldActive = true;
      selectWeldTool();
    }
    return;
  }
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement
  ) {
    return;
  }
  if (selectedTool === "tile" && selectedKind === TileKind.Magnet && !running) {
    let orientation: Direction | null = null;
    if (event.code === "KeyQ") {
      orientation = ((selectedOrientation + 3) & 3) as Direction;
    } else if (event.code === "KeyE") {
      orientation = ((selectedOrientation + 1) & 3) as Direction;
    } else if (event.code === "KeyW") {
      orientation = Direction.Up;
    } else if (event.code === "KeyD") {
      orientation = Direction.Right;
    } else if (event.code === "KeyS") {
      orientation = Direction.Down;
    } else if (event.code === "KeyA") {
      orientation = Direction.Left;
    }
    if (orientation !== null) {
      event.preventDefault();
      setSelectedOrientation(orientation);
      return;
    }
  }


  if (event.code === "Space") {
    event.preventDefault();
    setRunning(!running);
  } else if (event.code === "KeyN" && !running) {
    advanceSimulation(MANUAL_STEP_ANIMATION_MS);
  } else if (event.code === "KeyR") {
    setRunning(false);
    simulation.resetTo(baseline);
    finishAnimation();
  } else if (event.code === "Digit1") {
    selectTile(TileKind.Sand);
  } else if (event.code === "Digit2") {
    selectTile(TileKind.Stone);
  } else if (event.code === "Digit3") {
    selectTile(TileKind.Platform);
  } else if (event.code === "Digit4") {
    selectTile(TileKind.Magnet);
  } else if (event.code === "Digit5") {
    selectTile(TileKind.Metal);
  }
});

document.addEventListener("keyup", (event) => {
  if (event.key === "Control" && temporaryWeldActive) {
    temporaryWeldActive = false;
    selectTile(selectedKind);
  }
});

window.addEventListener("blur", () => {
  if (temporaryWeldActive) {
    temporaryWeldActive = false;
    selectTile(selectedKind);
  }
});

function frame(currentTime: number): void {
  const elapsed = Math.min(currentTime - previousFrameTime, 250);
  previousFrameTime = currentTime;

  if (running) {
    accumulatedTime += elapsed;
    const ticksPerSecond = Number(speedSelect.value);
    const tickDuration = 1000 / ticksPerSecond;
    while (accumulatedTime >= tickDuration) {
      accumulatedTime -= tickDuration;
      advanceSimulation(
        Math.min(tickDuration, MAX_AUTOMATIC_ANIMATION_MS),
        currentTime - accumulatedTime,
      );
    }
  }

  if (renderedTick !== simulation.tick) {
    tickCounter.textContent = `TICK ${simulation.tick.toString().padStart(4, "0")}`;
    renderedTick = simulation.tick;
  }
  const animationProgress = easedAnimationProgress(currentTime);
  renderer.render(animationDuration === 0 ? null : previousWorld, animationProgress);
  requestAnimationFrame(frame);
}

updateTransportState();
renderPalettePreviews();
requestAnimationFrame(frame);
