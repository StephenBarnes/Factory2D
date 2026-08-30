import "./styles.css";

import { CanvasRenderer } from "./render/canvas-renderer";
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
  for (const item of palette.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    const itemKind = item.dataset.tile;
    const selected =
      (kind === TileKind.Sand && itemKind === "sand") ||
      (kind === TileKind.Stone && itemKind === "stone") ||
      (kind === TileKind.Empty && itemKind === "empty");
    item.classList.toggle("selected", selected);
  }
}

function editCell(clientX: number, clientY: number, erase: boolean): void {
  if (running) {
    return;
  }

  const cell = renderer.cellFromClientPoint(clientX, clientY);
  if (cell === null) {
    return;
  }

  world.place(cell.x, cell.y, erase ? TileKind.Empty : selectedKind);
  baseline.copyFrom(world);
  simulation.tick = 0;
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
  editCell(event.clientX, event.clientY, event.button === 2);
});

canvas.addEventListener("pointermove", (event) => {
  const cell = renderer.cellFromClientPoint(event.clientX, event.clientY);
  renderer.setHover(cell);
  coordinates.textContent = cell === null
    ? "X --   Y --"
    : `X ${cell.x.toString().padStart(2, "0")}   Y ${cell.y.toString().padStart(2, "0")}`;
});

canvas.addEventListener("pointerleave", () => {
  renderer.setHover(null);
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
