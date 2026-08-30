import "./styles.css";

import { CanvasRenderer } from "./render/canvas-renderer";
import {
  cellsOnGridSegment,
  visitCrossedGridEdges,
} from "./render/grid-drag";
import type { GridCell, GridEdge, GridPoint } from "./render/grid-drag";
import { drawTile } from "./render/tile-renderer";
import {
  exceedsPanDragThreshold,
  pointerGesture,
} from "./render/pointer-gesture";
import type { PointerGesture } from "./render/pointer-gesture";
import { Simulation } from "./simulation/simulation";
import { Direction, TileKind } from "./simulation/tile";
import { World } from "./simulation/world";
import { TileInspector } from "./ui/tile-inspector";

const MAX_AUTOMATIC_ANIMATION_MS = 250;
const MANUAL_STEP_ANIMATION_MS = 200;
const HIGH_SPEED_TICKS_PER_SECOND = 60;
const PALETTE_PREVIEW_SUPERSAMPLING = 2;
const KEYBOARD_PAN_PIXELS = 64;

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
const bottomControls = requiredElement<HTMLElement>("bottom-controls");
const inspectorPanel = requiredElement<HTMLElement>("tile-inspector");
const tileInspector = new TileInspector(inspectorPanel, world);
const playButton = requiredElement<HTMLButtonElement>("play-button");
const stepButton = requiredElement<HTMLButtonElement>("step-button");
const resetButton = requiredElement<HTMLButtonElement>("reset-button");
const clearButton = requiredElement<HTMLButtonElement>("clear-button");
const animationToggle = requiredElement<HTMLInputElement>("animation-toggle");
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
let activePointerMode: PointerGesture | null = null;
let activeErase = false;
let lastPanClientX = 0;
let lastPanClientY = 0;
let pendingPickCell: GridCell | null = null;
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
let renderedPaletteDevicePixelRatio = 0;

function updateViewportInsets(): void {
  const canvasBounds = canvas.getBoundingClientRect();
  const sidebarBounds = sidebarControls.getBoundingClientRect();
  const controlsBounds = bottomControls.getBoundingClientRect();
  const inspectorBounds = inspectorPanel.getBoundingClientRect();
  renderer.setViewportInsets({
    top: 16,
    right: Math.max(16, canvasBounds.right - inspectorBounds.left + 16),
    bottom: Math.max(16, canvasBounds.bottom - controlsBounds.top + 16),
    left: Math.max(16, sidebarBounds.right - canvasBounds.left + 16),
  });
}

const overlayResizeObserver = new ResizeObserver(updateViewportInsets);
overlayResizeObserver.observe(sidebarControls);
overlayResizeObserver.observe(bottomControls);
overlayResizeObserver.observe(inspectorPanel);
updateViewportInsets();

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
function animationsEnabled(): boolean {
  return animationToggle.checked &&
    Number(speedSelect.value) < HIGH_SPEED_TICKS_PER_SECOND;
}

function updateAnimationControlState(): void {
  const highSpeed = Number(speedSelect.value) >= HIGH_SPEED_TICKS_PER_SECOND;
  if (highSpeed) {
    animationToggle.checked = false;
  }
  animationToggle.disabled = highSpeed;
  if (!animationsEnabled()) {
    finishAnimation();
  }
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
  tileInspector.update(hoveredCell);
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
  const devicePixelRatio = window.devicePixelRatio || 1;
  const pixelRatio = devicePixelRatio * PALETTE_PREVIEW_SUPERSAMPLING;
  renderedPaletteDevicePixelRatio = devicePixelRatio;

  for (const preview of sidebarControls.querySelectorAll<HTMLCanvasElement>(".tile-preview")) {
    const logicalWidth = preview.clientWidth;
    const logicalHeight = preview.clientHeight;
    if (logicalWidth === 0 || logicalHeight === 0) {
      continue;
    }
    const backingWidth = Math.max(1, Math.round(logicalWidth * pixelRatio));
    const backingHeight = Math.max(1, Math.round(logicalHeight * pixelRatio));
    if (preview.width !== backingWidth || preview.height !== backingHeight) {
      preview.width = backingWidth;
      preview.height = backingHeight;
    }

    const kind = Number(preview.dataset.tilePreview) as TileKind;
    const context = preview.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D is not supported by this browser");
    }
    context.setTransform(
      backingWidth / logicalWidth,
      0,
      0,
      backingHeight / logicalHeight,
      0,
      0,
    );
    context.clearRect(0, 0, logicalWidth, logicalHeight);

    const tileSize = Math.min(logicalWidth, logicalHeight);
    drawTile(
      context,
      (logicalWidth - tileSize) / 2,
      (logicalHeight - tileSize) / 2,
      tileSize,
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
  advanceSimulation(animationsEnabled() ? MANUAL_STEP_ANIMATION_MS : 0);
});
animationToggle.addEventListener("change", () => {
  if (!animationToggle.checked) {
    finishAnimation();
  }
});

speedSelect.addEventListener("change", () => {
  accumulatedTime = 0;
  updateAnimationControlState();
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
  const point = renderer.gridPointFromClientPoint(event.clientX, event.clientY);
  const cell = renderer.cellFromGridPoint(point);
  const gesture = pointerGesture(event.button, event.altKey);

  if (gesture === null || (running && gesture === "edit")) {
    return;
  }

  event.preventDefault();
  activePointerId = event.pointerId;
  activePointerMode = gesture;
  lastPanClientX = event.clientX;
  lastPanClientY = event.clientY;
  pendingPickCell = gesture === "pick-or-pan" ? cell : null;
  canvas.setPointerCapture(event.pointerId);

  if (gesture === "pick-or-pan") {
    return;
  }

  if (gesture === "pan") {
    canvas.classList.add("panning");
    hoveredCell = null;
    hoveredEdge = null;
    refreshPointerHover();
    return;
  }

  activeErase = event.button === 2;
  lastPointerGridPoint = point;
  if (selectedTool === "tile") {
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
  if (activePointerMode === "pick-or-pan") {
    const deltaX = event.clientX - lastPanClientX;
    const deltaY = event.clientY - lastPanClientY;
    if (!exceedsPanDragThreshold(deltaX, deltaY)) {
      return;
    }
    activePointerMode = "pan";
    canvas.classList.add("panning");
  }
  if (activePointerMode === "pan") {
    renderer.panByPixels(event.clientX - lastPanClientX, event.clientY - lastPanClientY);
    lastPanClientX = event.clientX;
    lastPanClientY = event.clientY;
    hoveredCell = null;
    hoveredEdge = null;
    refreshPointerHover();
    return;
  }
  if (activePointerMode !== "edit" || lastPointerGridPoint === null) {
    throw new Error("Active edit pointer is missing its edit state");
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

function finishPointerGesture(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) {
    return;
  }
  if (
    event.type === "pointerup" &&
    activePointerMode === "pick-or-pan" &&
    pendingPickCell !== null
  ) {
    const kind = world.kindAt(pendingPickCell.x, pendingPickCell.y);
    if (kind !== TileKind.Empty) {
      selectTile(kind);
      if (kind === TileKind.Magnet) {
        setSelectedOrientation(
          world.orientationAt(pendingPickCell.x, pendingPickCell.y),
        );
      }
    }
  }
  activePointerId = null;
  activePointerMode = null;
  pendingPickCell = null;
  lastEditedCell = null;
  lastPointerGridPoint = null;
  canvas.classList.remove("panning");
}

canvas.addEventListener("pointerup", finishPointerGesture);
canvas.addEventListener("pointercancel", finishPointerGesture);

canvas.addEventListener("pointerleave", () => {
  hoveredCell = null;
  hoveredEdge = null;
  refreshPointerHover();
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  renderer.zoomAtClientPoint(event.clientX, event.clientY, event.deltaY);
  const point = renderer.gridPointFromClientPoint(event.clientX, event.clientY);
  hoveredCell = renderer.cellFromGridPoint(point);
  hoveredEdge = renderer.edgeFromGridPoint(point);
  refreshPointerHover();
}, { passive: false });

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
  if (event.code === "ArrowLeft") {
    event.preventDefault();
    renderer.panByPixels(KEYBOARD_PAN_PIXELS, 0);
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    renderer.panByPixels(-KEYBOARD_PAN_PIXELS, 0);
  } else if (event.code === "ArrowUp") {
    event.preventDefault();
    renderer.panByPixels(0, KEYBOARD_PAN_PIXELS);
  } else if (event.code === "ArrowDown") {
    event.preventDefault();
    renderer.panByPixels(0, -KEYBOARD_PAN_PIXELS);
  }
  if (event.code.startsWith("Arrow")) {
    hoveredCell = null;
    hoveredEdge = null;
    refreshPointerHover();
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
    advanceSimulation(animationsEnabled() ? MANUAL_STEP_ANIMATION_MS : 0);
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
window.addEventListener("resize", () => {
  renderPalettePreviews();
  updateViewportInsets();
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
        animationsEnabled() ? Math.min(tickDuration, MAX_AUTOMATIC_ANIMATION_MS) : 0,
        currentTime - accumulatedTime,
      );
    }
  }
  const devicePixelRatio = window.devicePixelRatio || 1;
  if (renderedPaletteDevicePixelRatio !== devicePixelRatio) {
    renderPalettePreviews();
  }

  if (renderedTick !== simulation.tick) {
    tickCounter.textContent = `TICK ${simulation.tick.toString().padStart(4, "0")}`;
    renderedTick = simulation.tick;
  }
  tileInspector.update(hoveredCell);
  const animationProgress = easedAnimationProgress(currentTime);
  renderer.render(animationDuration === 0 ? null : previousWorld, animationProgress);
  requestAnimationFrame(frame);
}

updateTransportState();
updateAnimationControlState();
renderPalettePreviews();
requestAnimationFrame(frame);
