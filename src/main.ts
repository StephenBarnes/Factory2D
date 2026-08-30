import "./styles.css";

import { CanvasRenderer } from "./render/canvas-renderer";
import type { GridCell, GridEdge } from "./render/canvas-renderer";
import { Simulation } from "./simulation/simulation";
import { TileKind } from "./simulation/tile";
import { World } from "./simulation/world";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}

const world = new World(20, 14);
for (let x = 0; x < world.width; x += 1) {
  world.place(x, world.height - 1, TileKind.Stone);
}
for (let x = 3; x <= 7; x += 1) {
  world.place(x, 9, TileKind.Stone);
}
for (let x = 13; x <= 16; x += 1) {
  world.place(x, 11, TileKind.Stone);
}
world.place(5, 3, TileKind.Sand);
world.place(5, 4, TileKind.Sand);
world.place(11, 2, TileKind.Sand);
world.place(15, 5, TileKind.Sand);

const simulation = new Simulation(world);
const baseline = world.clone();
const canvas = requiredElement<HTMLCanvasElement>("game-canvas");
const renderer = new CanvasRenderer(canvas, world);
const palette = requiredElement<HTMLDivElement>("palette");
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
let selectedTool: "tile" | "weld" = "tile";
let activePointerId: number | null = null;
let activeErase = false;
let lastEditedCell: GridCell | null = null;
let lastEditedEdge: GridEdge | null = null;
let running = false;
let accumulatedTime = 0;
let previousFrameTime = performance.now();
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

function selectTile(kind: TileKind): void {
  selectedKind = kind;
  selectedTool = "tile";
  const selectedName =
    kind === TileKind.Sand ? "sand" :
    kind === TileKind.Stone ? "stone" :
    "empty";
  for (const item of palette.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.classList.toggle("selected", item.dataset.tile === selectedName);
  }
  renderer.setHover(null);
}

function selectWeldTool(): void {
  selectedTool = "weld";
  for (const item of palette.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.classList.toggle("selected", item.dataset.tool === "weld");
  }
  renderer.setHoverEdge(null);
}

function saveEditedBaseline(): void {
  baseline.copyFrom(world);
  simulation.tick = 0;
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

  while (true) {
    if (world.kindAt(x, y) !== kind) {
      world.place(x, y, kind);
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

function edgesMatch(first: GridEdge | null, second: GridEdge): boolean {
  return first !== null &&
    first.x1 === second.x1 &&
    first.y1 === second.y1 &&
    first.x2 === second.x2 &&
    first.y2 === second.y2;
}

palette.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".palette-item");
  const tileName = button?.dataset.tile;
  if (tileName === "sand") {
    selectTile(TileKind.Sand);
  } else if (tileName === "stone") {
    selectTile(TileKind.Stone);
  } else if (tileName === "empty") {
    selectTile(TileKind.Empty);
  } else if (button?.dataset.tool === "weld") {
    selectWeldTool();
  }
});

playButton.addEventListener("click", () => {
  setRunning(!running);
});

stepButton.addEventListener("click", () => {
  simulation.step();
});

resetButton.addEventListener("click", () => {
  setRunning(false);
  simulation.resetTo(baseline);
});

clearButton.addEventListener("click", () => {
  if (running) {
    return;
  }
  world.clear();
  baseline.copyFrom(world);
  simulation.tick = 0;
});

canvas.addEventListener("pointerdown", (event) => {
  if (running || (event.button !== 0 && event.button !== 2)) {
    return;
  }

  event.preventDefault();
  activePointerId = event.pointerId;
  activeErase = event.button === 2;
  canvas.setPointerCapture(event.pointerId);

  if (selectedTool === "tile") {
    const cell = renderer.cellFromClientPoint(event.clientX, event.clientY);
    if (cell !== null) {
      editCellLine(cell, cell, activeErase);
      lastEditedCell = cell;
    }
  } else {
    const edge = renderer.edgeFromClientPoint(event.clientX, event.clientY);
    if (edge !== null) {
      editWeld(edge, activeErase);
      lastEditedEdge = edge;
    }
  }
});

canvas.addEventListener("pointermove", (event) => {
  const cell = renderer.cellFromClientPoint(event.clientX, event.clientY);
  const edge = selectedTool === "weld"
    ? renderer.edgeFromClientPoint(event.clientX, event.clientY)
    : null;
  if (selectedTool === "weld") {
    renderer.setHoverEdge(edge);
  } else {
    renderer.setHover(cell);
  }
  coordinates.textContent = cell === null
    ? "X --   Y --"
    : `X ${cell.x.toString().padStart(2, "0")}   Y ${cell.y.toString().padStart(2, "0")}`;

  if (event.pointerId !== activePointerId) {
    return;
  }
  if (selectedTool === "tile" && cell !== null) {
    editCellLine(lastEditedCell ?? cell, cell, activeErase);
    lastEditedCell = cell;
  } else if (selectedTool === "weld" && edge !== null && !edgesMatch(lastEditedEdge, edge)) {
    editWeld(edge, activeErase);
    lastEditedEdge = edge;
  }
});

function finishPointerEdit(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) {
    return;
  }
  activePointerId = null;
  lastEditedCell = null;
  lastEditedEdge = null;
}

canvas.addEventListener("pointerup", finishPointerEdit);
canvas.addEventListener("pointercancel", finishPointerEdit);

canvas.addEventListener("pointerleave", () => {
  if (selectedTool === "weld") {
    renderer.setHoverEdge(null);
  } else {
    renderer.setHover(null);
  }
  coordinates.textContent = "X --   Y --";
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLSelectElement) {
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    setRunning(!running);
  } else if (event.code === "KeyN" && !running) {
    simulation.step();
  } else if (event.code === "KeyR") {
    setRunning(false);
    simulation.resetTo(baseline);
  } else if (event.code === "Digit1") {
    selectTile(TileKind.Sand);
  } else if (event.code === "Digit2") {
    selectTile(TileKind.Stone);
  } else if (event.code === "Digit3") {
    selectWeldTool();
  } else if (event.code === "Digit0") {
    selectTile(TileKind.Empty);
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
      simulation.step();
      accumulatedTime -= tickDuration;
    }
  }

  if (renderedTick !== simulation.tick) {
    tickCounter.textContent = `TICK ${simulation.tick.toString().padStart(4, "0")}`;
    renderedTick = simulation.tick;
  }
  renderer.render();
  requestAnimationFrame(frame);
}

updateTransportState();
requestAnimationFrame(frame);
