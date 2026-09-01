import "./styles.css";
import type {
  DevelopmentDiagnosticSnapshot,
  DiagnosticDirection,
} from "./dev/diagnostic-snapshot";
import { NavigationController } from "./game/navigation-controller";
import { SavedSolutionController } from "./game/saved-solution-controller";
import { PuzzleTestController } from "./game/puzzle-test-controller";
import { serializePuzzleTemplate } from "./game/puzzle-export";
import { computePuzzleDesignMetrics } from "./game/puzzle-scores";
import { createSandboxWorld, puzzleById } from "./game/puzzles";
import { WorkshopSessionController } from "./game/workshop-session";
import { WorkshopSurfaceController } from "./game/workshop-surface-controller";

import { visitCrossedGridEdges } from "./render/grid-drag";
import type { GridCell, GridEdge, GridPoint } from "./render/grid-drag";
import { drawTile } from "./render/tile-renderer";
import { componentConfigurationForKind } from "./simulation/configurable-components";
import { deserializeBoard, serializeBoard } from "./simulation/board-export";
import { PuzzleResult } from "./simulation/puzzle-result";
import {
  directionX,
  directionY,
  Direction,
  orientationForKind,
  TILE_DEFINITIONS,
  isTileKind,
  TileKind,
} from "./simulation/tile";
import { expectDefined } from "./util/assert";
import {
  ComponentConfigurationDialog,
  type ComponentConfigurationSubmission,
} from "./ui/component-configuration-dialog";
import {
  CanvasInteractionController,
  type BuildTool,
} from "./ui/canvas-interaction-controller";
import type { InspectorComponentReference } from "./ui/tile-inspector";
import { populateComponentPalette } from "./ui/component-palette";

const MAX_AUTOMATIC_ANIMATION_MS = 250;
const MANUAL_STEP_ANIMATION_MS = 200;
const HIGH_SPEED_TICKS_PER_SECOND = 60;
const PALETTE_PREVIEW_SUPERSAMPLING = 2;
const KEYBOARD_PAN_PIXELS = 64;
const MAX_CLIPBOARD_EXPORT_CHARACTERS = 1_000_000;
const DIAGNOSTIC_DIRECTIONS: Readonly<Record<Direction, DiagnosticDirection>> = {
  [Direction.Up]: "up",
  [Direction.Right]: "right",
  [Direction.Down]: "down",
  [Direction.Left]: "left",
};

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}

const sessions = new WorkshopSessionController(createSandboxWorld());
const canvas = requiredElement<HTMLCanvasElement>("game-canvas");
const gameScreen = requiredElement<HTMLElement>("game-screen");
const mainMenuScreen = requiredElement<HTMLElement>("main-menu-screen");
const puzzleInfoScreen = requiredElement<HTMLElement>("puzzle-info-screen");
const puzzleMap = requiredElement<HTMLElement>("puzzle-map");
const sandboxButton = requiredElement<HTMLButtonElement>("sandbox-button");
const menuButton = requiredElement<HTMLButtonElement>("menu-button");
const screenTitle = requiredElement<HTMLElement>("screen-title");
const workshopInfoButton = requiredElement<HTMLButtonElement>("workshop-info-button");
const workshopInfoDialog = requiredElement<HTMLDialogElement>("workshop-info-dialog");
const puzzleMetrics = requiredElement<HTMLElement>("puzzle-metrics");
const puzzlePrice = requiredElement<HTMLElement>("puzzle-price");
const puzzleFootprint = requiredElement<HTMLElement>("puzzle-footprint");
const sidebarControls = requiredElement<HTMLElement>("sidebar-controls");
const componentPalette = requiredElement<HTMLElement>("component-palette");
const inspectorPanel = requiredElement<HTMLElement>("tile-inspector");
const surface = new WorkshopSurfaceController(sessions, canvas, inspectorPanel);
const playButton = requiredElement<HTMLButtonElement>("play-button");
const transportShortcutLabel = requiredElement<HTMLElement>("transport-shortcut-label");
const testReportDialog = requiredElement<HTMLDialogElement>("test-report-dialog");
const fastForwardButton = requiredElement<HTMLButtonElement>("fast-forward-button");
const testCaseDropup = requiredElement<HTMLElement>("test-case-dropup");
const testCaseButton = requiredElement<HTMLButtonElement>("test-case-button");
const testCaseOptions = requiredElement<HTMLElement>("test-case-options");
const testStatusToast = requiredElement<HTMLElement>("test-status-toast");
const componentConfigurationDialogElement = requiredElement<HTMLDialogElement>(
  "component-configuration-dialog",
);
const stepButton = requiredElement<HTMLButtonElement>("step-button");
const resetButton = requiredElement<HTMLButtonElement>("reset-button");
const clearButton = requiredElement<HTMLButtonElement>("clear-button");
const exportDropup = requiredElement<HTMLElement>("export-dropup");
const exportButton = requiredElement<HTMLButtonElement>("export-button");
const exportOptions = requiredElement<HTMLElement>("export-options");
const downloadSceneButton = requiredElement<HTMLButtonElement>("download-scene-button");
const copySceneButton = requiredElement<HTMLButtonElement>("copy-scene-button");
const downloadImageButton = requiredElement<HTMLButtonElement>("download-image-button");
const downloadPuzzleButton = requiredElement<HTMLButtonElement>("download-puzzle-button");
const sharePuzzleButton = requiredElement<HTMLButtonElement>("share-puzzle-button");
const importButton = requiredElement<HTMLButtonElement>("import-button");
const importFile = requiredElement<HTMLInputElement>("import-file");
const animationToggle = requiredElement<HTMLInputElement>("animation-toggle");
const speedSelect = requiredElement<HTMLSelectElement>("speed-select");
const stateLight = requiredElement<HTMLSpanElement>("state-light");
const stateLabel = requiredElement<HTMLSpanElement>("state-label");
const tickCounter = requiredElement<HTMLSpanElement>("tick-counter");
const coordinates = requiredElement<HTMLDivElement>("coordinates");
const selectionActions = requiredElement<HTMLElement>("selection-actions");
const selectionCopyButton = requiredElement<HTMLButtonElement>("selection-copy-button");
const selectionPasteButton = requiredElement<HTMLButtonElement>("selection-paste-button");
const selectionHorizontalFlipButton = requiredElement<HTMLButtonElement>(
  "selection-flip-horizontal-button",
);
const selectionVerticalFlipButton = requiredElement<HTMLButtonElement>(
  "selection-flip-vertical-button",
);
const selectionRotateButton = requiredElement<HTMLButtonElement>("selection-rotate-button");

type InspectorTool = Exclude<BuildTool, "tile">;

interface ToolInspectorDetails {
  readonly name: string;
  readonly description: string;
  readonly controls: string;
}

const TOOL_INSPECTOR_DETAILS: Readonly<Record<InspectorTool, ToolInspectorDetails>> = {
  weld: {
    name: "Weld tool",
    description: "Joins adjacent occupied tiles into rigid bodies.",
    controls: "LEFT CLICK / DRAG WELD · RIGHT CLICK / DRAG UNWELD · HOLD CONTROL TEMPORARILY",
  },
  selection: {
    name: "Selection tool",
    description: "Selects, moves, copies, and transforms a grid-aligned group of tiles.",
    controls: "LEFT DRAG SELECT / MOVE · DELETE · CTRL+C / X / V / A · WASD ROTATE · FLIP",
  },
  "editable-region": {
    name: "Editable region tool",
    description: "Marks the board areas where a puzzle solution may place and remove tiles.",
    controls: "LEFT DRAG ADD RECTANGLE · RIGHT CLICK REMOVE RECTANGLE",
  },
};

function isInspectorTool(value: string | undefined): value is InspectorTool {
  return value === "weld" || value === "selection" || value === "editable-region";
}


let selectedKind = TileKind.Sand;
let previousSelectedKind: TileKind = selectedKind;
let selectedOrientation = Direction.Up;
let selectedTool: BuildTool = "tile";
let temporaryWeldActive = false;
let running = false;
let accumulatedTime = 0;
let previousFrameTime = performance.now();
let animationStartedAt = 0;
let animationDuration = 0;
let renderedTick = -1;
let renderedPaletteDevicePixelRatio = 0;
let tileKindsByShortcut: Readonly<Record<string, TileKind | undefined>> =
  Object.create(null);
let componentInspectorReferences: readonly (InspectorComponentReference | undefined)[] = [];


function updateTransportState(): void {
  const editingEnabled = surface.session.editingState.editable;
  const puzzleWorkshop = navigation.screen.kind === "puzzle";
  const testingPuzzleSolution = puzzleTests.testing;
  const testLifecycle = puzzleTests.lifecycle.kind;
  const testFailed = testLifecycle === "failed";
  playButton.textContent = puzzleWorkshop
    ? testingPuzzleSolution ? "TESTING…" : "◆ TEST"
    : running ? "Ⅱ PAUSE" : "▶ RUN";
  playButton.disabled = testingPuzzleSolution;
  playButton.classList.toggle("running", !puzzleWorkshop && running);
  fastForwardButton.hidden = !testingPuzzleSolution;
  fastForwardButton.disabled = !testingPuzzleSolution;
  testCaseButton.disabled = testingPuzzleSolution;
  stateLight.classList.toggle("running", running || testingPuzzleSolution);
  stateLight.classList.toggle("failed", testFailed);
  stateLabel.textContent = testingPuzzleSolution
    ? testLifecycle === "between-cases" ? "CASE PASSED" : "TESTING CASE"
    : testFailed ? "TEST FAILED"
    : running ? "SIMULATING" : editingEnabled ? "BUILD MODE" : "RESET TO EDIT";
  stepButton.disabled = running || testingPuzzleSolution;
  clearButton.disabled = !editingEnabled || testingPuzzleSolution;
  transportShortcutLabel.textContent = puzzleWorkshop ? "TEST SOLUTION" : "RUN / PAUSE";
  for (const item of sidebarControls.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.disabled = !editingEnabled || testingPuzzleSolution;
  }
}

function markSimulationStarted(): boolean {
  return sessions.beginSimulation();
}
function refreshPuzzleMetrics(): void {
  const screen = navigation.screen;
  const puzzleWorkshop = screen.kind === "puzzle";
  puzzleMetrics.hidden = !puzzleWorkshop;
  if (!puzzleWorkshop) {
    componentPalette.classList.remove("show-prices");
    return;
  }

  const metrics = computePuzzleDesignMetrics(
    puzzleById(screen.puzzleId),
    surface.session.baseline,
  );
  puzzlePrice.textContent = `${metrics.price}⚙`;
  puzzleFootprint.textContent = `${metrics.footprintWidth}×${metrics.footprintHeight}`;
}


function commitTileSelection(): void {
  const result = surface.selection.commit(
    surface.world,
    (x, y) =>
      x >= 0 &&
      x < surface.world.width &&
      y >= 0 &&
      y < surface.world.height &&
      canEditCell(x, y),
    componentIsAvailable,
  );
  syncTileSelectionOverlay();
  if (result.changed) {
    commitEditedWorld();
  }
}

function setRunning(nextRunning: boolean): void {
  if (nextRunning) {
    finalizeActivePointerGesture();
  }
  if (nextRunning && surface.selection.active) {
    commitTileSelection();
  }
  const editingChanged = nextRunning && markSimulationStarted();
  running = nextRunning;
  accumulatedTime = 0;
  updateTransportState();
  if (editingChanged) {
    refreshPointerHover();
  }
}

surface.setMountListener(() => {
  syncTileSelectionOverlay();
  syncEditableRegionAuthoringOverlay();
  renderedTick = -1;
  animationDuration = 0;
  updateTransportState();
  refreshPointerHover();
});



function finishAnimation(): void {
  surface.previousWorld.copyFrom(surface.world);
  animationDuration = 0;
}
function animationsEnabled(ticksPerSecond = Number(speedSelect.value)): boolean {
  return animationToggle.checked && ticksPerSecond !== HIGH_SPEED_TICKS_PER_SECOND;
}

function finishAnimationIfDisabled(): void {
  if (!animationsEnabled()) {
    finishAnimation();
  }
}


function advanceSimulation(duration: number, startedAt = performance.now()): void {
  finalizeActivePointerGesture();
  if (surface.selection.active) {
    commitTileSelection();
  }
  if (markSimulationStarted()) {
    updateTransportState();
    refreshPointerHover();
  }
  surface.previousWorld.copyFrom(surface.world);
  surface.simulation.step(duration > 0 ? surface.previousWorld : undefined);

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

function inspectorReferenceFromButton(
  button: HTMLButtonElement,
): InspectorComponentReference {
  const priceLabel = button.dataset.price;
  const shortcutLabel = button.dataset.shortcut;
  if (priceLabel === undefined || shortcutLabel === undefined) {
    throw new Error("Component palette button is missing inspector metadata");
  }
  const price = priceLabel === "" ? null : Number(priceLabel);
  if (price !== null && (!Number.isSafeInteger(price) || price < 0)) {
    throw new Error("Component palette button has invalid price metadata");
  }
  return {
    price,
    shortcut: shortcutLabel === "" ? null : shortcutLabel,
  };
}

function showInspectorReference(button: HTMLButtonElement): void {
  const kind = Number(button.dataset.tile);
  if (isTileKind(kind) && TILE_DEFINITIONS[kind].palette !== null) {
    surface.inspector.showPalette(kind, inspectorReferenceFromButton(button));
    return;
  }

  const tool = button.dataset.tool;
  if (!isInspectorTool(tool)) {
    throw new Error("Hovered palette item has invalid inspector metadata");
  }
  const details = TOOL_INSPECTOR_DETAILS[tool];
  surface.inspector.showTool(details.name, details.description, details.controls);
}

function refreshTileInspector(): void {
  if (surface.hoveredPaletteButton !== null) {
    showInspectorReference(surface.hoveredPaletteButton);
    return;
  }
  if (surface.hoveredCell !== null) {
    const kind = surface.world.kindAt(surface.hoveredCell.x, surface.hoveredCell.y);
    surface.inspector.update(surface.hoveredCell, componentInspectorReferences[kind] ?? null);
    return;
  }
  surface.inspector.update(null, null);
}

function refreshPointerHover(): void {
  if (!surface.session.editingState.editable) {
    surface.renderer.setHover(surface.hoveredCell);
  } else if (selectedTool === "weld") {
    surface.renderer.setHoverEdge(surface.hoveredEdge);
  } else if (selectedTool === "selection") {
    surface.renderer.setHover(surface.selection.active || surface.selection.drafting ? null : surface.hoveredCell);
  } else if (selectedTool === "editable-region") {
    surface.renderer.setHover(surface.hoveredCell);
  } else {
    surface.renderer.setHover(
      surface.hoveredCell,
      selectedKind,
      orientationForKind(selectedKind, selectedOrientation),
    );
  }
  coordinates.textContent = surface.hoveredCell === null
    ? "X --   Y --"
    : `X ${surface.hoveredCell.x.toString().padStart(2, "0")}   Y ${surface.hoveredCell.y.toString().padStart(2, "0")}`;
  refreshTileInspector();
}

function syncEditableRegionAuthoringOverlay(): void {
  const authoring = selectedTool === "editable-region"
    ? surface.session.editableRegionAuthoring
    : null;
  surface.renderer.setEditableRegionAuthoring(
    authoring?.region ?? null,
    authoring?.draftRectangle ?? null,
  );
}
function syncTileSelectionOverlay(): void {
  const selectionActive = selectedTool === "selection";
  const overlay = selectionActive
    ? surface.selection.overlay(canEditCell, componentIsAvailable)
    : null;
  surface.renderer.setTileSelection(
    overlay,
    selectionActive ? surface.selection.draftRegion(surface.session.editableRegion) : null,
  );
  selectionActions.hidden = overlay === null;
  selectionPasteButton.disabled = !surface.selection.hasClipboard;
}

function positionSelectionActions(): void {
  if (selectionActions.hidden) {
    return;
  }
  const overlay = surface.selection.overlay(canEditCell, componentIsAvailable);
  const bounds = overlay === null ? null : surface.renderer.screenBoundsForGridRegion(overlay.region);
  if (bounds === null) {
    selectionActions.hidden = true;
    return;
  }
  const halfPanelWidth = selectionActions.offsetWidth / 2;
  const centerX = (bounds.left + bounds.right) / 2;
  selectionActions.style.left = `${Math.max(
    halfPanelWidth + 6,
    Math.min(canvas.clientWidth - halfPanelWidth - 6, centerX),
  )}px`;
  selectionActions.style.top = `${Math.max(selectionActions.offsetHeight + 6, bounds.top - 6)}px`;
}



function configureComponentPalette(): void {
  surface.hoveredPaletteButton = null;
  if (selectedTool === "editable-region" && surface.session.editableRegionAuthoring === null) {
    selectedTool = "tile";
  }
  const availableComponents = surface.session.availableComponents;
  if (availableComponents !== null && !availableComponents.has(selectedKind)) {
    selectedKind = expectDefined(
      availableComponents.entries[0],
      "Puzzle component list is unexpectedly empty",
    ).kind;
  }
  if (availableComponents !== null && !availableComponents.has(previousSelectedKind)) {
    previousSelectedKind = selectedKind;
  }
  tileKindsByShortcut = populateComponentPalette(
    componentPalette,
    selectedTool === "tile" ? selectedKind : null,
    availableComponents,
  );
  const references: (InspectorComponentReference | undefined)[] = [];
  for (const button of componentPalette.querySelectorAll<HTMLButtonElement>("[data-tile]")) {
    const kind = Number(button.dataset.tile);
    if (!isTileKind(kind) || TILE_DEFINITIONS[kind].palette === null) {
      throw new Error("Component palette button has invalid tile metadata");
    }
    references[kind] = inspectorReferenceFromButton(button);
  }
  componentInspectorReferences = references;
  const weldButton = sidebarControls.querySelector<HTMLButtonElement>("[data-tool=\"weld\"]");
  const selectionButton = sidebarControls.querySelector<HTMLButtonElement>(
    "[data-tool=\"selection\"]",
  );
  const editableRegionButton = sidebarControls.querySelector<HTMLButtonElement>(
    "[data-tool=\"editable-region\"]",
  );
  if (weldButton === null || selectionButton === null || editableRegionButton === null) {
    throw new Error("Tool palette buttons are missing");
  }
  weldButton.classList.toggle("selected", selectedTool === "weld");
  selectionButton.classList.toggle("selected", selectedTool === "selection");
  editableRegionButton.hidden = surface.session.editableRegionAuthoring === null;
  editableRegionButton.classList.toggle("selected", selectedTool === "editable-region");
  syncEditableRegionAuthoringOverlay();
  syncTileSelectionOverlay();
  renderPalettePreviews();
}

function selectTile(kind: TileKind): void {
  if (!componentIsAvailable(kind)) {
    return;
  }
  if (selectedTool === "selection") {
    commitTileSelection();
  }
  if (kind !== selectedKind) {
    previousSelectedKind = selectedKind;
    selectedKind = kind;
  }
  if (temporaryWeldActive) {
    selectWeldTool();
    return;
  }

  selectedTool = "tile";
  for (const item of sidebarControls.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.classList.toggle("selected", item.dataset.tile === String(kind));
  }
  syncEditableRegionAuthoringOverlay();
  refreshPointerHover();
}

function pickTileAt(cell: GridCell): void {
  const kind = surface.world.kindAt(cell.x, cell.y);
  if (kind === TileKind.Empty) {
    selectTile(previousSelectedKind);
    return;
  }
  const pickedKind = kind === TileKind.PistonBase || kind === TileKind.PistonArm
    ? TileKind.Piston
    : kind;
  if (!componentIsAvailable(pickedKind)) {
    return;
  }

  selectTile(pickedKind);
  if (TILE_DEFINITIONS[pickedKind].usesOrientation) {
    setSelectedOrientation(surface.world.orientationAt(cell.x, cell.y));
  }
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
      orientationForKind(kind, selectedOrientation),
    );
  }
}

function setSelectedOrientation(orientation: Direction): void {
  selectedOrientation = orientation;
  renderPalettePreviews();
  refreshPointerHover();
}

function selectWeldTool(): void {
  if (selectedTool === "selection") {
    commitTileSelection();
  }
  selectedTool = "weld";
  for (const item of sidebarControls.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.classList.toggle("selected", item.dataset.tool === "weld");
  }
  syncEditableRegionAuthoringOverlay();
  refreshPointerHover();
}
function selectSelectionTool(): void {
  selectedTool = "selection";
  for (const item of sidebarControls.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.classList.toggle("selected", item.dataset.tool === "selection");
  }
  syncEditableRegionAuthoringOverlay();
  syncTileSelectionOverlay();
  refreshPointerHover();
}


function selectEditableRegionTool(): void {
  if (surface.session.editableRegionAuthoring === null) {
    return;
  }
  if (selectedTool === "selection") {
    commitTileSelection();
  }
  selectedTool = "editable-region";
  for (const item of sidebarControls.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.classList.toggle("selected", item.dataset.tool === "editable-region");
  }
  syncEditableRegionAuthoringOverlay();
  syncTileSelectionOverlay();
  refreshPointerHover();
}

function commitEditedWorld(): void {
  sessions.saveEditedBaseline();
  finishAnimation();
  navigation.markActiveSolutionDirty();
  navigation.persistActiveSolutionBoard();
  refreshPuzzleMetrics();
}

function componentIsAvailable(kind: TileKind): boolean {
  return surface.session.availableComponents?.has(kind) ?? true;
}

function canEditCell(x: number, y: number): boolean {
  return surface.session.editableRegion?.contains(x, y) ?? true;
}

function canEditEdge(x1: number, y1: number, x2: number, y2: number): boolean {
  return surface.session.editableRegion?.containsEdge(x1, y1, x2, y2) ?? true;
}

function weldEligibleEditableNeighbors(x: number, y: number): boolean {
  if (surface.session.editableRegion === null) {
    return surface.world.weldEligibleNeighbors(x, y);
  }

  let changed = false;
  for (let value = Direction.Up; value <= Direction.Left; value += 1) {
    const direction = value as Direction;
    const neighborX = x + directionX(direction);
    const neighborY = y + directionY(direction);
    if (
      neighborX >= 0 &&
      neighborX < surface.world.width &&
      neighborY >= 0 &&
      neighborY < surface.world.height &&
      canEditEdge(x, y, neighborX, neighborY)
    ) {
      changed = surface.world.setWeld(x, y, neighborX, neighborY, true) || changed;
    }
  }
  return changed;
}

function editCellLine(
  from: GridCell,
  to: GridCell,
  erase: boolean,
  weldPlacedTiles: boolean,
): boolean {
  if (!surface.session.editingState.editable || (!erase && !componentIsAvailable(selectedKind))) {
    return false;
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
  const orientation = orientationForKind(selectedKind, selectedOrientation);

  while (true) {
    if (canEditCell(x, y)) {
      if (
        surface.world.kindAt(x, y) !== kind ||
        (
          kind !== TileKind.Empty &&
          surface.world.orientationAt(x, y) !== orientation
        )
      ) {
        surface.world.place(x, y, kind, orientation);
        changed = true;
      }
      if (weldPlacedTiles && kind !== TileKind.Empty) {
        changed = weldEligibleEditableNeighbors(x, y) || changed;
      }
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

  return changed;
}
function openComponentConfiguration(cell: GridCell): void {
  if (!surface.session.editingState.editable || !canEditCell(cell.x, cell.y)) {
    return;
  }
  const kind = surface.world.kindAt(cell.x, cell.y);
  if (componentConfigurationForKind(kind) === null) {
    return;
  }
  const state = surface.world.componentStateSnapshotAt(cell.x, cell.y);
  if (state === null) {
    throw new Error(`${TILE_DEFINITIONS[kind].name} is missing configuration state`);
  }
  const tileId = surface.world.idAt(cell.x, cell.y);
  componentConfigurationView.show(
    kind,
    state,
    (submission: ComponentConfigurationSubmission) => {
      if (
        !surface.session.editingState.editable ||
        surface.world.idAt(cell.x, cell.y) !== tileId ||
        surface.world.kindAt(cell.x, cell.y) !== kind
      ) {
        return;
      }
      const changed = submission.type === "number"
        ? surface.world.configureNumericComponent(cell.x, cell.y, submission.value)
        : surface.world.configureRom(
            cell.x,
            cell.y,
            submission.width,
            submission.height,
            submission.values,
          );
      if (changed) {
        commitEditedWorld();
        refreshPointerHover();
      }
    },
  );
}

function adjustHoveredNumericComponent(delta: number): boolean {
  if (
    surface.hoveredCell === null ||
    !surface.session.editingState.editable ||
    !canEditCell(surface.hoveredCell.x, surface.hoveredCell.y)
  ) {
    return false;
  }
  const kind = surface.world.kindAt(surface.hoveredCell.x, surface.hoveredCell.y);
  const configuration = componentConfigurationForKind(kind);
  const state = surface.world.componentStateSnapshotAt(surface.hoveredCell.x, surface.hoveredCell.y);
  if (
    configuration === null ||
    configuration.type !== "number" ||
    (state?.type !== "delay" && state?.type !== "counter")
  ) {
    return false;
  }
  const currentValue = state.type === "delay" ? state.length : state.threshold;
  const nextValue = Math.min(
    configuration.maximum,
    Math.max(configuration.minimum, currentValue + delta),
  );
  if (nextValue === currentValue) {
    return true;
  }
  surface.world.configureNumericComponent(surface.hoveredCell.x, surface.hoveredCell.y, nextValue);
  commitEditedWorld();
  refreshPointerHover();
  return true;
}


function editWeld(edge: GridEdge, erase: boolean): boolean {
  return (
    surface.session.editingState.editable &&
    canEditEdge(edge.x1, edge.y1, edge.x2, edge.y2) &&
    surface.world.setWeld(edge.x1, edge.y1, edge.x2, edge.y2, !erase)
  );
}

function editWeldSegment(
  from: GridPoint,
  to: GridPoint,
  endpointEdge: GridEdge | null,
  erase: boolean,
): boolean {
  if (!surface.session.editingState.editable) {
    return false;
  }

  let changed = false;
  visitCrossedGridEdges(from, to, surface.world.width, surface.world.height, (x1, y1, x2, y2) => {
    if (canEditEdge(x1, y1, x2, y2)) {
      changed = surface.world.setWeld(x1, y1, x2, y2, !erase) || changed;
    }
  });
  if (
    endpointEdge !== null &&
    canEditEdge(endpointEdge.x1, endpointEdge.y1, endpointEdge.x2, endpointEdge.y2)
  ) {
    changed = surface.world.setWeld(
      endpointEdge.x1,
      endpointEdge.y1,
      endpointEdge.x2,
      endpointEdge.y2,
      !erase,
    ) || changed;
  }
  return changed;
}
const componentConfigurationView = new ComponentConfigurationDialog(
  componentConfigurationDialogElement,
);
const canvasInteraction = new CanvasInteractionController(surface, {
  getSelectedTool: () => selectedTool,
  getSelectedKind: () => selectedKind,
  editCellLine,
  editWeld,
  editWeldSegment,
  commitSelection: commitTileSelection,
  syncSelectionOverlay: syncTileSelectionOverlay,
  syncEditableRegionOverlay: syncEditableRegionAuthoringOverlay,
  refreshHover: refreshPointerHover,
  pickTile: pickTileAt,
  openConfiguration: openComponentConfiguration,
  commitEditTransaction: commitEditedWorld,
});
surface.setInteractionCanceler(() => {
  canvasInteraction.cancel();
});
function prepareForRuntimeChange(): void {
  finalizeActivePointerGesture();
  if (surface.selection.active) {
    commitTileSelection();
  }
}

const puzzleTests = new PuzzleTestController(
  {
    caseDropup: testCaseDropup,
    caseButton: testCaseButton,
    caseOptions: testCaseOptions,
    statusToast: testStatusToast,
    reportDialog: testReportDialog,
  },
  {
    getBaseline: () => surface.session.baseline,
    prepareForRuntimeChange,
    resetSession: () => sessions.resetSimulation(),
    beginSimulation: () => {
      sessions.beginSimulation();
    },
    mountRuntime: (world, simulation) => {
      surface.mountActiveSession({
        fitBoard: true,
        cancelInteraction: true,
        updateSession: () => {
          if (simulation === undefined) {
            sessions.showActiveRuntime(world);
          } else {
            sessions.showActiveRuntime(world, simulation);
          }
        },
      });
    },
    beforeStep: () => {
      surface.previousWorld.copyFrom(surface.world);
      return surface.previousWorld;
    },
    setStepAnimation: (startedAt, duration) => {
      animationStartedAt = startedAt;
      animationDuration = duration;
    },
    finishAnimation,
    animationsEnabled,
    recordResult: (scores) => navigation.recordActivePuzzleTestResult(scores),
    refreshTransport: updateTransportState,
    refreshHover: refreshPointerHover,
    leaveWorkshop: () => navigation.leaveWorkshop(),
  },
);

function stopWorkshopActivity(): void {
  prepareForRuntimeChange();
  puzzleTests.stop();
  componentConfigurationView.close();
  closeExportOptions();
  setRunning(false);
}

const savedSolutions = new SavedSolutionController(window.localStorage);
const navigation = new NavigationController(
  {
    gameScreen,
    mainMenuScreen,
    puzzleInfoScreen,
    puzzleMap,
    screenTitle,
    menuButton,
    workshopInfoButton,
    workshopInfoDialog,
  },
  {
    stopSimulation: stopWorkshopActivity,
    onWorkshopSessionChanged: () => {
      surface.mountActiveSession({ fitBoard: true, cancelInteraction: true });
    },
    onWorkshopShown: () => {
      configureComponentPalette();
      refreshPuzzleMetrics();
      const screen = navigation.screen;
      puzzleTests.configure(screen.kind === "puzzle" ? puzzleById(screen.puzzleId) : null);
      updateTransportState();
      importButton.disabled = surface.session.editableRegion !== null;
      updateExportOptionsForSession();
    },
  },
  sessions,
  savedSolutions,
  window.localStorage,
  window.history,
);

if (import.meta.env.DEV) {
  const getDiagnosticSnapshot = (): DevelopmentDiagnosticSnapshot => {
    const screen = navigation.screen;
    const puzzleResult = surface.world.puzzleResult === PuzzleResult.InProgress
      ? "in-progress"
      : surface.world.puzzleResult === PuzzleResult.Won ? "won" : "lost";
    return {
      screen: { ...screen },
      activePuzzleId: screen.kind === "puzzle-info" || screen.kind === "puzzle"
        ? screen.puzzleId
        : null,
      activeSolutionId: screen.kind === "puzzle" ? screen.solutionId : null,
      simulation: {
        running: running || puzzleTests.testing,
        tick: surface.simulation.tick,
        editable: surface.session.editingState.editable,
        puzzleResult,
      },
      selectedTool: selectedTool === "weld"
        ? { kind: "weld" }
        : selectedTool === "selection"
        ? { kind: "selection" }
        : selectedTool === "editable-region"
        ? { kind: "editable-region" }
        : {
          kind: "tile",
          tileKind: TILE_DEFINITIONS[selectedKind].name,
          orientation: DIAGNOSTIC_DIRECTIONS[selectedOrientation],
        },
      hoveredCell: surface.hoveredCell === null ? null : { ...surface.hoveredCell },
      worldRevision: surface.world.revision,
      serializedBoard: serializeBoard(surface.world, surface.simulation.tick),
    };
  };
  void import("./dev/diagnostic-snapshot").then(({ installDevelopmentDiagnostics }) => {
    installDevelopmentDiagnostics(getDiagnosticSnapshot);
  });
}


menuButton.addEventListener("click", () => {
  navigation.leaveWorkshop();
});
puzzlePrice.addEventListener("pointerenter", () => {
  componentPalette.classList.add("show-prices");
});
puzzlePrice.addEventListener("pointerleave", () => {
  componentPalette.classList.remove("show-prices");
});

sandboxButton.addEventListener("click", () => {
  navigation.navigate({ kind: "sandbox" });
});

sidebarControls.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".palette-item");
  const tileKind = Number(button?.dataset.tile);
  if (isTileKind(tileKind) && TILE_DEFINITIONS[tileKind].palette !== null) {
    selectTile(tileKind);
  } else if (button?.dataset.tool === "weld") {
    selectWeldTool();
  } else if (button?.dataset.tool === "selection") {
    selectSelectionTool();
  } else if (button?.dataset.tool === "editable-region") {
    selectEditableRegionTool();
  }
});
function copyTileSelection(): void {
  if (surface.selection.copy()) {
    syncTileSelectionOverlay();
  }
}

function deleteTileSelection(): void {
  if (!surface.selection.active) {
    return;
  }
  const changed = surface.selection.deleteFrom(surface.world);
  syncTileSelectionOverlay();
  refreshPointerHover();
  if (changed) {
    commitEditedWorld();
  }
}

function pasteTileSelection(): void {
  if (!surface.selection.hasClipboard) {
    return;
  }
  const currentOverlay = surface.selection.overlay(canEditCell, componentIsAvailable);
  const currentRectangle = currentOverlay?.region.rectangles[0];
  const anchor = surface.hoveredCell ?? (currentRectangle === undefined
    ? { x: 0, y: 0 }
    : { x: currentRectangle.x + 1, y: currentRectangle.y + 1 });
  if (surface.selection.active) {
    commitTileSelection();
  }
  selectSelectionTool();
  surface.selection.paste(anchor.x, anchor.y);
  syncTileSelectionOverlay();
  refreshPointerHover();
}

selectionCopyButton.addEventListener("click", copyTileSelection);
selectionPasteButton.addEventListener("click", pasteTileSelection);
selectionHorizontalFlipButton.addEventListener("click", () => {
  surface.selection.flipHorizontally();
  syncTileSelectionOverlay();
});
selectionVerticalFlipButton.addEventListener("click", () => {
  surface.selection.flipVertically();
  syncTileSelectionOverlay();
});
selectionRotateButton.addEventListener("click", () => {
  surface.selection.rotateClockwise();
  syncTileSelectionOverlay();
});


sidebarControls.addEventListener("pointerover", (event) => {
  surface.hoveredPaletteButton = (event.target as HTMLElement).closest<HTMLButtonElement>(".palette-item");
  refreshTileInspector();
});

sidebarControls.addEventListener("pointerout", (event) => {
  const nextButton = event.relatedTarget instanceof HTMLElement
    ? event.relatedTarget.closest<HTMLButtonElement>(".palette-item")
    : null;
  if (nextButton === surface.hoveredPaletteButton) {
    return;
  }
  surface.hoveredPaletteButton = nextButton;
  refreshTileInspector();
});


playButton.addEventListener("click", () => {
  if (navigation.screen.kind === "puzzle") {
    puzzleTests.start();
  } else {
    setRunning(!running);
  }
});

fastForwardButton.addEventListener("click", () => {
  puzzleTests.fastForward();
});

testCaseButton.addEventListener("click", () => {
  puzzleTests.toggleCaseOptions();
});

stepButton.addEventListener("click", () => {
  advanceSimulation(animationsEnabled() ? MANUAL_STEP_ANIMATION_MS : 0);
});
animationToggle.addEventListener("change", finishAnimationIfDisabled);

speedSelect.addEventListener("change", () => {
  accumulatedTime = 0;
  finishAnimationIfDisabled();
});


function resetSimulation(): void {
  setRunning(false);
  if (navigation.screen.kind === "puzzle") {
    puzzleTests.reset();
    return;
  }
  prepareForRuntimeChange();
  sessions.resetSimulation();
  finishAnimation();
  updateTransportState();
  refreshPointerHover();
}

resetButton.addEventListener("click", resetSimulation);

clearButton.addEventListener("click", () => {
  if (!surface.session.editingState.editable) {
    return;
  }
  if (surface.selection.active) {
    commitTileSelection();
  }
  if (surface.session.editableRegion === null) {
    surface.world.clear();
  } else {
    for (let y = 0; y < surface.world.height; y += 1) {
      for (let x = 0; x < surface.world.width; x += 1) {
        if (canEditCell(x, y) && surface.world.kindAt(x, y) !== TileKind.Empty) {
          surface.world.place(x, y, TileKind.Empty);
        }
      }
    }
  }
  commitEditedWorld();
});

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = objectUrl;
  download.download = filename;
  document.body.append(download);
  download.click();
  download.remove();
  URL.revokeObjectURL(objectUrl);
}

function setExportOptionsOpen(open: boolean): void {
  exportOptions.hidden = !open;
  exportButton.setAttribute("aria-expanded", String(open));
}

function closeExportOptions(): void {
  setExportOptionsOpen(false);
}

function updateExportOptionsForSession(): void {
  const sandboxOnly = surface.session.editableRegion === null;
  downloadPuzzleButton.hidden = !sandboxOnly;
  sharePuzzleButton.hidden = !sandboxOnly;
  sharePuzzleButton.disabled = true;
  if (!sandboxOnly) {
    closeExportOptions();
  }
}

exportButton.addEventListener("click", () => {
  setExportOptionsOpen(exportOptions.hidden !== false);
});

downloadSceneButton.addEventListener("click", () => {
  closeExportOptions();
  const source = serializeBoard(surface.world, surface.simulation.tick);
  downloadBlob(new Blob([source], { type: "application/json" }), "factory2d-scene.json");
});

copySceneButton.addEventListener("click", () => {
  closeExportOptions();
  const source = serializeBoard(surface.world, surface.simulation.tick);
  if (source.length > MAX_CLIPBOARD_EXPORT_CHARACTERS) {
    window.alert(
      "This scene is too large to copy to the clipboard. Download the scene file instead.",
    );
    return;
  }
  void navigator.clipboard.writeText(source).catch((error: unknown) => {
    console.warn("Could not copy the scene to the clipboard", error);
  });
});

downloadImageButton.addEventListener("click", () => {
  closeExportOptions();
  canvas.toBlob((blob) => {
    if (blob === null) {
      throw new Error("Could not encode the grid image as PNG");
    }
    downloadBlob(blob, "factory2d-grid.png");
  }, "image/png");
});

downloadPuzzleButton.addEventListener("click", () => {
  if (surface.session.editableRegion !== null) {
    throw new Error("Puzzle files can only be exported from the sandbox");
  }
  closeExportOptions();
  const authoring = surface.session.editableRegionAuthoring;
  if (authoring === null) {
    throw new Error("Sandbox editable-region authoring state is missing");
  }
  const source = serializePuzzleTemplate(surface.world, authoring.region);
  downloadBlob(new Blob([source], { type: "application/json" }), "factory2d-puzzle.json");
});

document.addEventListener("click", (event) => {
  if (event.target instanceof Node && !exportDropup.contains(event.target)) {
    closeExportOptions();
  }
  if (event.target instanceof Node && !testCaseDropup.contains(event.target)) {
    puzzleTests.closeCaseOptions();
  }
});

importButton.addEventListener("click", () => {
  if (surface.session.editableRegion === null) {
    importFile.click();
  }
});

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (file === undefined) {
    return;
  }
  if (surface.session.editableRegion !== null) {
    return;
  }


  importButton.disabled = true;
  try {
    finalizeActivePointerGesture();
    const imported = deserializeBoard(await file.text());
    surface.mountActiveSession({
      fitBoard: true,
      cancelInteraction: true,
      updateSession: () => sessions.replaceActiveWorld(imported.world, imported.tick),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.alert(`Could not import board: ${message}`);
  } finally {
    importButton.disabled = surface.session.editableRegion !== null;
  }
});

function finalizeActivePointerGesture(): boolean {
  return canvasInteraction.cancel();
}

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const point = surface.renderer.gridPointFromClientPoint(event.clientX, event.clientY);
  surface.hoveredCell = surface.renderer.cellFromGridPoint(point);
  surface.hoveredEdge = surface.renderer.edgeFromGridPoint(point);
  if (
    event.shiftKey &&
    event.deltaY !== 0 &&
    adjustHoveredNumericComponent(event.deltaY < 0 ? 1 : -1)
  ) {
    return;
  }
  surface.renderer.zoomAtClientPoint(event.clientX, event.clientY, event.deltaY);
  refreshPointerHover();
}, { passive: false });

document.addEventListener("keydown", (event) => {
  if (!exportOptions.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeExportOptions();
      exportButton.focus();
      return;
    }
    if (event.target instanceof Node && exportDropup.contains(event.target)) {
      return;
    }
  }
  if (
    navigation.screen.kind === "main-menu" ||
    navigation.screen.kind === "puzzle-info" ||
    testReportDialog.open ||
    componentConfigurationView.open
  ) {
    return;
  }
  if (event.key === "Control") {
    if (!event.repeat && selectedTool === "tile") {
      temporaryWeldActive = true;
      selectWeldTool();
    }
    return;
  }
  const textEntryTarget =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement;
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !textEntryTarget &&
    surface.session.editingState.editable
  ) {
    if (event.code === "KeyA") {
      event.preventDefault();
      if (surface.selection.active) {
        commitTileSelection();
      }
      selectSelectionTool();
      surface.selection.selectOccupiedBounds(surface.world, surface.session.editableRegion);
      syncTileSelectionOverlay();
      refreshPointerHover();
      return;
    }
    if (event.code === "KeyC" && surface.selection.active) {
      event.preventDefault();
      copyTileSelection();
      return;
    }
    if (event.code === "KeyX" && surface.selection.active) {
      event.preventDefault();
      copyTileSelection();
      deleteTileSelection();
      return;
    }
    if (event.code === "KeyV" && surface.selection.hasClipboard) {
      event.preventDefault();
      pasteTileSelection();
      return;
    }
  }
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    textEntryTarget
  ) {
    return;
  }
  if (event.code === "ArrowLeft") {
    event.preventDefault();
    surface.renderer.panByPixels(KEYBOARD_PAN_PIXELS, 0);
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    surface.renderer.panByPixels(-KEYBOARD_PAN_PIXELS, 0);
  } else if (event.code === "ArrowUp") {
    event.preventDefault();
    surface.renderer.panByPixels(0, KEYBOARD_PAN_PIXELS);
  } else if (event.code === "ArrowDown") {
    event.preventDefault();
    surface.renderer.panByPixels(0, -KEYBOARD_PAN_PIXELS);
  }
  if (event.code.startsWith("Arrow")) {
    surface.hoveredCell = null;
    surface.hoveredEdge = null;
    refreshPointerHover();
    return;
  }
  if (event.code === "KeyQ") {
    event.preventDefault();
    if (surface.hoveredCell !== null) {
      pickTileAt(surface.hoveredCell);
    }
    return;
  }
  if (
    event.code === "KeyE" &&
    surface.hoveredCell !== null &&
    surface.session.editingState.editable &&
    componentConfigurationForKind(surface.world.kindAt(surface.hoveredCell.x, surface.hoveredCell.y)) !== null
  ) {
    event.preventDefault();
    openComponentConfiguration(surface.hoveredCell);
    return;
  }

  if (selectedTool === "selection" && surface.selection.active) {
    if (event.code === "Delete" || event.code === "Backspace") {
      event.preventDefault();
      deleteTileSelection();
      return;
    }
    let orientation: Direction | null = null;
    if (event.code === "KeyW") {
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
      surface.selection.rotateTo(orientation);
      syncTileSelectionOverlay();
      return;
    }
  }

  if (
    selectedTool === "tile" &&
    TILE_DEFINITIONS[selectedKind].usesOrientation &&
    surface.session.editingState.editable
  ) {
    let orientation: Direction | null = null;
    if (event.code === "KeyW") {
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
    if (navigation.screen.kind === "puzzle") {
      puzzleTests.start();
    } else {
      setRunning(!running);
    }
  } else if (event.code === "KeyN" && !running && !puzzleTests.testing) {
    advanceSimulation(animationsEnabled() ? MANUAL_STEP_ANIMATION_MS : 0);
  } else if (event.code === "KeyR") {
    resetSimulation();
  } else {
    const shortcutKind = tileKindsByShortcut[event.code];
    if (shortcutKind !== undefined) {
      selectTile(shortcutKind);
    }
  }
});

document.addEventListener("keyup", (event) => {
  if (event.key === "Control" && temporaryWeldActive) {
    temporaryWeldActive = false;
    if (selectedTool === "weld") {
      selectTile(selectedKind);
    }
  }
});

window.addEventListener("blur", () => {
  if (temporaryWeldActive) {
    temporaryWeldActive = false;
    if (selectedTool === "weld") {
      selectTile(selectedKind);
    }
  }
});
window.addEventListener("popstate", () => {
  navigation.navigatePath(window.location.pathname);
});
window.addEventListener("pagehide", () => {
  if (!finalizeActivePointerGesture()) {
    navigation.persistActiveSolutionBoard();
  }
});
window.addEventListener("resize", renderPalettePreviews);


function frame(currentTime: number): void {
  const elapsed = Math.min(currentTime - previousFrameTime, 250);
  previousFrameTime = currentTime;
  if (navigation.screen.kind === "main-menu" || navigation.screen.kind === "puzzle-info") {
    requestAnimationFrame(frame);
    return;
  }
  puzzleTests.advanceFrame(currentTime, elapsed);


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

  if (renderedTick !== surface.simulation.tick) {
    tickCounter.textContent = `TICK ${surface.simulation.tick.toString().padStart(4, "0")}`;
    renderedTick = surface.simulation.tick;
  }
  refreshTileInspector();
  const animationProgress = easedAnimationProgress(currentTime);
  surface.renderer.render(
    animationDuration === 0 ? null : surface.previousWorld,
    animationProgress,
    currentTime,
  );
  positionSelectionActions();
  requestAnimationFrame(frame);
}

updateTransportState();
navigation.navigatePath(window.location.pathname);
requestAnimationFrame(frame);
