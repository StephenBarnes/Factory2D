import "./styles.css";
import type {
  DevelopmentDiagnosticSnapshot,
  DiagnosticDirection,
} from "./dev/diagnostic-snapshot";
import { NavigationController } from "./game/navigation-controller";
import { SavedSolutionController } from "./game/saved-solution-controller";
import { runPuzzleTests } from "./game/puzzle-test-runner";
import { serializePuzzleTemplate } from "./game/puzzle-export";
import { createSandboxWorld, puzzleById } from "./game/puzzles";
import {
  type WorkshopSession,
  WorkshopSessionController,
} from "./game/workshop-session";
import { TileSelectionState } from "./game/tile-selection";

import { CanvasRenderer } from "./render/canvas-renderer";
import {
  clampedCellFromGridPoint,
  cellsOnGridSegment,
  visitCrossedGridEdges,
} from "./render/grid-drag";
import type { GridCell, GridEdge, GridPoint } from "./render/grid-drag";
import { drawTile } from "./render/tile-renderer";
import {
  exceedsPanDragThreshold,
  pointerGesture,
  shouldWeldPlacedTile,
} from "./render/pointer-gesture";
import type { PointerGesture } from "./render/pointer-gesture";
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
  type InspectorComponentReference,
  TileInspector,
} from "./ui/tile-inspector";
import { populateComponentPalette } from "./ui/component-palette";
import { PuzzleTestReportView } from "./ui/puzzle-test-report";

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
let activeSession: WorkshopSession = sessions.active;
let world = activeSession.world;
let simulation = activeSession.simulation;
let previousWorld = activeSession.previousWorld;
const canvas = requiredElement<HTMLCanvasElement>("game-canvas");
let renderer = new CanvasRenderer(canvas, world, activeSession.editableRegion);
const gameScreen = requiredElement<HTMLElement>("game-screen");
const mainMenuScreen = requiredElement<HTMLElement>("main-menu-screen");
const puzzleInfoScreen = requiredElement<HTMLElement>("puzzle-info-screen");
const puzzleMap = requiredElement<HTMLElement>("puzzle-map");
const sandboxButton = requiredElement<HTMLButtonElement>("sandbox-button");
const menuButton = requiredElement<HTMLButtonElement>("menu-button");
const screenTitle = requiredElement<HTMLElement>("screen-title");
const screenDescription = requiredElement<HTMLElement>("screen-description");
const sidebarControls = requiredElement<HTMLElement>("sidebar-controls");
const componentPalette = requiredElement<HTMLElement>("component-palette");
const inspectorPanel = requiredElement<HTMLElement>("tile-inspector");
let tileInspector = new TileInspector(inspectorPanel, world);
const playButton = requiredElement<HTMLButtonElement>("play-button");
const transportShortcutLabel = requiredElement<HTMLElement>("transport-shortcut-label");
const testReportDialog = requiredElement<HTMLDialogElement>("test-report-dialog");
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
const selectionFlipButton = requiredElement<HTMLButtonElement>("selection-flip-button");
const selectionRotateButton = requiredElement<HTMLButtonElement>("selection-rotate-button");

type BuildTool = "tile" | "weld" | "selection" | "editable-region";
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
    controls: "LEFT DRAG SELECT / MOVE · DELETE · CTRL+C / X / V / A · WASD ROTATE",
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


let testingPuzzleSolution = false;
let selectedKind = TileKind.Sand;
let previousSelectedKind: TileKind = selectedKind;
let selectedOrientation = Direction.Up;
let selectedTool: BuildTool = "tile";
let tileSelection = new TileSelectionState(world.width, world.height);
let temporaryWeldActive = false;
let activePointerId: number | null = null;
let activePointerMode: PointerGesture | null = null;
let activeEditTool: BuildTool | null = null;
let activeErase = false;
let activeWeldPlacement = false;
let lastPanClientX = 0;
let lastPanClientY = 0;
let pendingPickCell: GridCell | null = null;
let lastEditedCell: GridCell | null = null;
let pendingConfigurationCell: GridCell | null = null;
let lastPointerGridPoint: GridPoint | null = null;
let hoveredCell: GridCell | null = null;
let hoveredEdge: GridEdge | null = null;
let hoveredPaletteButton: HTMLButtonElement | null = null;
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
  const editingEnabled = activeSession.editingState.editable;
  const puzzleWorkshop = navigation.screen.kind === "puzzle";
  playButton.textContent = puzzleWorkshop
    ? testingPuzzleSolution ? "TESTING…" : "◆ TEST"
    : running ? "Ⅱ PAUSE" : "▶ RUN";
  playButton.disabled = testingPuzzleSolution;
  playButton.classList.toggle("running", !puzzleWorkshop && running);
  stateLight.classList.toggle("running", running || testingPuzzleSolution);
  stateLabel.textContent = testingPuzzleSolution
    ? "TESTING CASES"
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

function commitTileSelection(): void {
  const result = tileSelection.commit(
    world,
    (x, y) =>
      x >= 0 &&
      x < world.width &&
      y >= 0 &&
      y < world.height &&
      canEditCell(x, y),
    componentIsAvailable,
  );
  syncTileSelectionOverlay();
  if (result.changed) {
    saveEditedBaseline();
    navigation.persistActiveSolutionBoard();
  }
}

function setRunning(nextRunning: boolean): void {
  if (nextRunning && tileSelection.active) {
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
function loadActiveWorkshopSession(): void {
  activeSession = sessions.active;
  world = activeSession.world;
  simulation = activeSession.simulation;
  previousWorld = activeSession.previousWorld;
  tileSelection = new TileSelectionState(world.width, world.height);
  renderer = new CanvasRenderer(canvas, world, activeSession.editableRegion);
  syncTileSelectionOverlay();
  syncEditableRegionAuthoringOverlay();
  tileInspector = new TileInspector(inspectorPanel, world);
  hoveredCell = null;
  hoveredEdge = null;
  lastEditedCell = null;
  hoveredPaletteButton = null;
  lastPointerGridPoint = null;
  renderedTick = -1;
  animationDuration = 0;
}


function finishAnimation(): void {
  previousWorld.copyFrom(world);
  animationDuration = 0;
}
function animationsEnabled(): boolean {
  return animationToggle.checked &&
    Number(speedSelect.value) !== HIGH_SPEED_TICKS_PER_SECOND;
}

function finishAnimationIfDisabled(): void {
  if (!animationsEnabled()) {
    finishAnimation();
  }
}


function advanceSimulation(duration: number, startedAt = performance.now()): void {
  if (tileSelection.active) {
    commitTileSelection();
  }
  if (markSimulationStarted()) {
    updateTransportState();
    refreshPointerHover();
  }
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
    tileInspector.showPalette(kind, inspectorReferenceFromButton(button));
    return;
  }

  const tool = button.dataset.tool;
  if (!isInspectorTool(tool)) {
    throw new Error("Hovered palette item has invalid inspector metadata");
  }
  const details = TOOL_INSPECTOR_DETAILS[tool];
  tileInspector.showTool(details.name, details.description, details.controls);
}

function refreshTileInspector(): void {
  if (hoveredPaletteButton !== null) {
    showInspectorReference(hoveredPaletteButton);
    return;
  }
  if (hoveredCell !== null) {
    const kind = world.kindAt(hoveredCell.x, hoveredCell.y);
    tileInspector.update(hoveredCell, componentInspectorReferences[kind] ?? null);
    return;
  }
  tileInspector.update(null, null);
}

function refreshPointerHover(): void {
  if (!activeSession.editingState.editable) {
    renderer.setHover(hoveredCell);
  } else if (selectedTool === "weld") {
    renderer.setHoverEdge(hoveredEdge);
  } else if (selectedTool === "selection") {
    renderer.setHover(tileSelection.active || tileSelection.drafting ? null : hoveredCell);
  } else if (selectedTool === "editable-region") {
    renderer.setHover(hoveredCell);
  } else {
    renderer.setHover(
      hoveredCell,
      selectedKind,
      orientationForKind(selectedKind, selectedOrientation),
    );
  }
  coordinates.textContent = hoveredCell === null
    ? "X --   Y --"
    : `X ${hoveredCell.x.toString().padStart(2, "0")}   Y ${hoveredCell.y.toString().padStart(2, "0")}`;
  refreshTileInspector();
}

function syncEditableRegionAuthoringOverlay(): void {
  const authoring = selectedTool === "editable-region"
    ? activeSession.editableRegionAuthoring
    : null;
  renderer.setEditableRegionAuthoring(
    authoring?.region ?? null,
    authoring?.draftRectangle ?? null,
  );
}
function syncTileSelectionOverlay(): void {
  const selectionActive = selectedTool === "selection";
  const overlay = selectionActive
    ? tileSelection.overlay(canEditCell, componentIsAvailable)
    : null;
  renderer.setTileSelection(
    overlay,
    selectionActive ? tileSelection.draftRegion(activeSession.editableRegion) : null,
  );
  selectionActions.hidden = overlay === null;
  selectionPasteButton.disabled = !tileSelection.hasClipboard;
}

function positionSelectionActions(): void {
  if (selectionActions.hidden) {
    return;
  }
  const overlay = tileSelection.overlay(canEditCell, componentIsAvailable);
  const bounds = overlay === null ? null : renderer.screenBoundsForGridRegion(overlay.region);
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

function sandboxEditableRegionAuthoring(): NonNullable<
  WorkshopSession["editableRegionAuthoring"]
> {
  const authoring = activeSession.editableRegionAuthoring;
  if (authoring === null) {
    throw new Error("Editable-region authoring is only available in the sandbox");
  }
  return authoring;
}


function configureComponentPalette(): void {
  hoveredPaletteButton = null;
  if (selectedTool === "editable-region" && activeSession.editableRegionAuthoring === null) {
    selectedTool = "tile";
  }
  const availableComponents = activeSession.availableComponents;
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
  editableRegionButton.hidden = activeSession.editableRegionAuthoring === null;
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
  const kind = world.kindAt(cell.x, cell.y);
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
    setSelectedOrientation(world.orientationAt(cell.x, cell.y));
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
  if (activeSession.editableRegionAuthoring === null) {
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

function saveEditedBaseline(): void {
  sessions.saveEditedBaseline();
  finishAnimation();
  navigation.markActiveSolutionDirty();
}

function componentIsAvailable(kind: TileKind): boolean {
  return activeSession.availableComponents?.has(kind) ?? true;
}

function canEditCell(x: number, y: number): boolean {
  return activeSession.editableRegion?.contains(x, y) ?? true;
}

function canEditEdge(x1: number, y1: number, x2: number, y2: number): boolean {
  return activeSession.editableRegion?.containsEdge(x1, y1, x2, y2) ?? true;
}

function weldEligibleEditableNeighbors(x: number, y: number): boolean {
  if (activeSession.editableRegion === null) {
    return world.weldEligibleNeighbors(x, y);
  }

  let changed = false;
  for (let value = Direction.Up; value <= Direction.Left; value += 1) {
    const direction = value as Direction;
    const neighborX = x + directionX(direction);
    const neighborY = y + directionY(direction);
    if (
      neighborX >= 0 &&
      neighborX < world.width &&
      neighborY >= 0 &&
      neighborY < world.height &&
      canEditEdge(x, y, neighborX, neighborY)
    ) {
      changed = world.setWeld(x, y, neighborX, neighborY, true) || changed;
    }
  }
  return changed;
}

function editCellLine(
  from: GridCell,
  to: GridCell,
  erase: boolean,
  weldPlacedTiles: boolean,
): void {
  if (!activeSession.editingState.editable || (!erase && !componentIsAvailable(selectedKind))) {
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
  const orientation = orientationForKind(selectedKind, selectedOrientation);

  while (true) {
    if (canEditCell(x, y)) {
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

  if (changed) {
    saveEditedBaseline();
  }
}
function openComponentConfiguration(cell: GridCell): void {
  if (!activeSession.editingState.editable || !canEditCell(cell.x, cell.y)) {
    return;
  }
  const kind = world.kindAt(cell.x, cell.y);
  if (componentConfigurationForKind(kind) === null) {
    return;
  }
  const state = world.componentStateSnapshotAt(cell.x, cell.y);
  if (state === null) {
    throw new Error(`${TILE_DEFINITIONS[kind].name} is missing configuration state`);
  }
  const tileId = world.idAt(cell.x, cell.y);
  componentConfigurationView.show(
    kind,
    state,
    (submission: ComponentConfigurationSubmission) => {
      if (
        !activeSession.editingState.editable ||
        world.idAt(cell.x, cell.y) !== tileId ||
        world.kindAt(cell.x, cell.y) !== kind
      ) {
        return;
      }
      const changed = submission.type === "number"
        ? world.configureNumericComponent(cell.x, cell.y, submission.value)
        : world.configureRom(
            cell.x,
            cell.y,
            submission.width,
            submission.height,
            submission.values,
          );
      if (changed) {
        saveEditedBaseline();
        navigation.persistActiveSolutionBoard();
        refreshPointerHover();
      }
    },
  );
}

function adjustHoveredNumericComponent(delta: number): boolean {
  if (
    hoveredCell === null ||
    !activeSession.editingState.editable ||
    !canEditCell(hoveredCell.x, hoveredCell.y)
  ) {
    return false;
  }
  const kind = world.kindAt(hoveredCell.x, hoveredCell.y);
  const configuration = componentConfigurationForKind(kind);
  const state = world.componentStateSnapshotAt(hoveredCell.x, hoveredCell.y);
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
  world.configureNumericComponent(hoveredCell.x, hoveredCell.y, nextValue);
  saveEditedBaseline();
  navigation.persistActiveSolutionBoard();
  refreshPointerHover();
  return true;
}


function editWeld(edge: GridEdge, erase: boolean): void {
  if (
    activeSession.editingState.editable &&
    canEditEdge(edge.x1, edge.y1, edge.x2, edge.y2) &&
    world.setWeld(edge.x1, edge.y1, edge.x2, edge.y2, !erase)
  ) {
    saveEditedBaseline();
  }
}

function editWeldSegment(
  from: GridPoint,
  to: GridPoint,
  endpointEdge: GridEdge | null,
  erase: boolean,
): void {
  if (!activeSession.editingState.editable) {
    return;
  }

  let changed = false;
  visitCrossedGridEdges(from, to, world.width, world.height, (x1, y1, x2, y2) => {
    if (canEditEdge(x1, y1, x2, y2)) {
      changed = world.setWeld(x1, y1, x2, y2, !erase) || changed;
    }
  });
  if (
    endpointEdge !== null &&
    canEditEdge(endpointEdge.x1, endpointEdge.y1, endpointEdge.x2, endpointEdge.y2)
  ) {
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
const componentConfigurationView = new ComponentConfigurationDialog(
  componentConfigurationDialogElement,
);
const testReportView = new PuzzleTestReportView(testReportDialog, {
  onContinueEditing: () => resetSimulation(),
  onBackToPuzzle: () => navigation.leaveWorkshop(),
});

function stopWorkshopActivity(): void {
  if (tileSelection.active) {
    commitTileSelection();
  }
  testingPuzzleSolution = false;
  testReportView.close();
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
    screenDescription,
    menuButton,
  },
  {
    stopSimulation: stopWorkshopActivity,
    onWorkshopSessionChanged: loadActiveWorkshopSession,
    onWorkshopShown: () => {
      configureComponentPalette();
      updateTransportState();
      importButton.disabled = activeSession.editableRegion !== null;
      updateExportOptionsForSession();
      renderer.fitBoardToViewport();
      refreshPointerHover();
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
    const puzzleResult = world.puzzleResult === PuzzleResult.InProgress
      ? "in-progress"
      : world.puzzleResult === PuzzleResult.Won ? "won" : "lost";
    return {
      screen: { ...screen },
      activePuzzleId: screen.kind === "puzzle-info" || screen.kind === "puzzle"
        ? screen.puzzleId
        : null,
      activeSolutionId: screen.kind === "puzzle" ? screen.solutionId : null,
      simulation: {
        running,
        tick: simulation.tick,
        editable: activeSession.editingState.editable,
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
      hoveredCell: hoveredCell === null ? null : { ...hoveredCell },
      worldRevision: world.revision,
      serializedBoard: serializeBoard(world, simulation.tick),
    };
  };
  void import("./dev/diagnostic-snapshot").then(({ installDevelopmentDiagnostics }) => {
    installDevelopmentDiagnostics(getDiagnosticSnapshot);
  });
}


menuButton.addEventListener("click", () => {
  navigation.leaveWorkshop();
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
  if (tileSelection.copy()) {
    syncTileSelectionOverlay();
  }
}

function deleteTileSelection(): void {
  if (!tileSelection.active) {
    return;
  }
  const changed = tileSelection.deleteFrom(world);
  syncTileSelectionOverlay();
  refreshPointerHover();
  if (changed) {
    saveEditedBaseline();
    navigation.persistActiveSolutionBoard();
  }
}

function pasteTileSelection(): void {
  if (!tileSelection.hasClipboard) {
    return;
  }
  const currentOverlay = tileSelection.overlay(canEditCell, componentIsAvailable);
  const currentRectangle = currentOverlay?.region.rectangles[0];
  const anchor = hoveredCell ?? (currentRectangle === undefined
    ? { x: 0, y: 0 }
    : { x: currentRectangle.x + 1, y: currentRectangle.y + 1 });
  if (tileSelection.active) {
    commitTileSelection();
  }
  selectSelectionTool();
  tileSelection.paste(anchor.x, anchor.y);
  syncTileSelectionOverlay();
  refreshPointerHover();
}

selectionCopyButton.addEventListener("click", copyTileSelection);
selectionPasteButton.addEventListener("click", pasteTileSelection);
selectionFlipButton.addEventListener("click", () => {
  tileSelection.flipHorizontally();
  syncTileSelectionOverlay();
});
selectionRotateButton.addEventListener("click", () => {
  tileSelection.rotateClockwise();
  syncTileSelectionOverlay();
});


sidebarControls.addEventListener("pointerover", (event) => {
  hoveredPaletteButton = (event.target as HTMLElement).closest<HTMLButtonElement>(".palette-item");
  refreshTileInspector();
});

sidebarControls.addEventListener("pointerout", (event) => {
  const nextButton = event.relatedTarget instanceof HTMLElement
    ? event.relatedTarget.closest<HTMLButtonElement>(".palette-item")
    : null;
  if (nextButton === hoveredPaletteButton) {
    return;
  }
  hoveredPaletteButton = nextButton;
  refreshTileInspector();
});


playButton.addEventListener("click", () => {
  if (navigation.screen.kind === "puzzle") {
    void testCurrentPuzzleSolution();
  } else {
    setRunning(!running);
  }
});

async function testCurrentPuzzleSolution(): Promise<void> {
  const requestedScreen = navigation.screen;
  if (requestedScreen.kind !== "puzzle" || testingPuzzleSolution) {
    return;
  }

  resetSimulation();
  testingPuzzleSolution = true;
  updateTransportState();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const currentScreen = navigation.screen;
  if (
    currentScreen.kind !== "puzzle" ||
    currentScreen.puzzleId !== requestedScreen.puzzleId ||
    currentScreen.solutionId !== requestedScreen.solutionId
  ) {
    return;
  }

  try {
    const report = runPuzzleTests(
      puzzleById(currentScreen.puzzleId),
      activeSession.baseline,
    );
    navigation.recordActivePuzzleTestResult(report.scores);
    testReportView.show(report);
  } finally {
    testingPuzzleSolution = false;
    updateTransportState();
  }
}

stepButton.addEventListener("click", () => {
  advanceSimulation(animationsEnabled() ? MANUAL_STEP_ANIMATION_MS : 0);
});
animationToggle.addEventListener("change", finishAnimationIfDisabled);

speedSelect.addEventListener("change", () => {
  accumulatedTime = 0;
  finishAnimationIfDisabled();
});


function resetSimulation(): void {
  if (tileSelection.active) {
    commitTileSelection();
  }
  setRunning(false);
  sessions.resetSimulation();
  finishAnimation();
  updateTransportState();
  refreshPointerHover();
}

resetButton.addEventListener("click", resetSimulation);

clearButton.addEventListener("click", () => {
  if (!activeSession.editingState.editable) {
    return;
  }
  if (tileSelection.active) {
    commitTileSelection();
  }
  if (activeSession.editableRegion === null) {
    world.clear();
  } else {
    for (let y = 0; y < world.height; y += 1) {
      for (let x = 0; x < world.width; x += 1) {
        if (canEditCell(x, y) && world.kindAt(x, y) !== TileKind.Empty) {
          world.place(x, y, TileKind.Empty);
        }
      }
    }
  }
  saveEditedBaseline();
  navigation.persistActiveSolutionBoard();
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
  const sandboxOnly = activeSession.editableRegion === null;
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
  const source = serializeBoard(world, simulation.tick);
  downloadBlob(new Blob([source], { type: "application/json" }), "factory2d-scene.json");
});

copySceneButton.addEventListener("click", () => {
  closeExportOptions();
  const source = serializeBoard(world, simulation.tick);
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
  if (activeSession.editableRegion !== null) {
    throw new Error("Puzzle files can only be exported from the sandbox");
  }
  closeExportOptions();
  const authoring = activeSession.editableRegionAuthoring;
  if (authoring === null) {
    throw new Error("Sandbox editable-region authoring state is missing");
  }
  const source = serializePuzzleTemplate(world, authoring.region);
  downloadBlob(new Blob([source], { type: "application/json" }), "factory2d-puzzle.json");
});

document.addEventListener("click", (event) => {
  if (event.target instanceof Node && !exportDropup.contains(event.target)) {
    closeExportOptions();
  }
});

importButton.addEventListener("click", () => {
  if (activeSession.editableRegion === null) {
    importFile.click();
  }
});

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (file === undefined) {
    return;
  }
  if (activeSession.editableRegion !== null) {
    return;
  }


  importButton.disabled = true;
  try {
    const imported = deserializeBoard(await file.text());
    sessions.replaceActiveWorld(imported.world, imported.tick);
    loadActiveWorkshopSession();
    renderer.fitBoardToViewport();
    refreshPointerHover();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.alert(`Could not import board: ${message}`);
  } finally {
    importButton.disabled = activeSession.editableRegion !== null;
  }
});

canvas.addEventListener("pointerdown", (event) => {
  const point = renderer.gridPointFromClientPoint(event.clientX, event.clientY);
  const cell = renderer.cellFromGridPoint(point);
  const gesture = pointerGesture(event.button, event.altKey);

  if (gesture === null || (!activeSession.editingState.editable && gesture === "edit")) {
    return;
  }

  event.preventDefault();
  activePointerId = event.pointerId;
  activePointerMode = gesture;
  activeEditTool = gesture === "edit" ? selectedTool : null;
  lastPanClientX = event.clientX;
  lastPanClientY = event.clientY;
  pendingPickCell = gesture === "pick-or-pan" ? cell : null;
  pendingConfigurationCell = null;
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
  activeWeldPlacement = shouldWeldPlacedTile(event.button, event.shiftKey);
  lastPointerGridPoint = point;
  const shouldConfigurePlacement =
    !activeErase &&
    cell !== null &&
    world.kindAt(cell.x, cell.y) !== selectedKind &&
    componentConfigurationForKind(selectedKind)?.configureOnPlacement === true;
  if (activeEditTool === "tile") {
    if (cell !== null) {
      editCellLine(cell, cell, activeErase, activeWeldPlacement);
      lastEditedCell = cell;
      if (shouldConfigurePlacement && world.kindAt(cell.x, cell.y) === selectedKind) {
        pendingConfigurationCell = cell;
      }
    }
  } else if (activeEditTool === "weld") {
    const edge = renderer.edgeFromGridPoint(point);
    if (edge !== null) {
      editWeld(edge, activeErase);
    }
  } else if (activeEditTool === "selection" && !activeErase) {
    if (cell === null) {
      if (tileSelection.active) {
        commitTileSelection();
      }
    } else if (!tileSelection.beginMove(cell.x, cell.y)) {
      if (tileSelection.active) {
        commitTileSelection();
      }
      tileSelection.beginSelection(cell.x, cell.y);
    }
    syncTileSelectionOverlay();
    refreshPointerHover();
  } else if (activeEditTool === "editable-region" && cell !== null) {
    const authoring = sandboxEditableRegionAuthoring();
    if (activeErase) {
      authoring.removeRectanglesAt(cell.x, cell.y);
    } else {
      authoring.beginRectangle(cell.x, cell.y);
    }
    syncEditableRegionAuthoringOverlay();
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

  if (activeEditTool === "tile") {
    const segment = cellsOnGridSegment(
      lastPointerGridPoint,
      point,
      world.width,
      world.height,
    );
    if (segment !== null) {
      editCellLine(
        lastEditedCell ?? segment.from,
        segment.to,
        activeErase,
        activeWeldPlacement,
      );
      lastEditedCell = segment.to;
    }
  } else if (activeEditTool === "weld") {
    editWeldSegment(lastPointerGridPoint, point, hoveredEdge, activeErase);
  } else if (activeEditTool === "selection" && !activeErase) {
    if (tileSelection.drafting) {
      const cell = clampedCellFromGridPoint(point, world.width, world.height);
      tileSelection.updateSelection(cell.x, cell.y);
    } else {
      tileSelection.updateMove(Math.floor(point.x), Math.floor(point.y));
    }
    syncTileSelectionOverlay();
  } else if (activeEditTool === "editable-region" && !activeErase) {
    const cell = clampedCellFromGridPoint(point, world.width, world.height);
    sandboxEditableRegionAuthoring().updateRectangle(cell.x, cell.y);
    syncEditableRegionAuthoringOverlay();
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
    pickTileAt(pendingPickCell);
  }
  if (activeEditTool === "editable-region") {
    const authoring = sandboxEditableRegionAuthoring();
    if (event.type === "pointerup" && !activeErase) {
      authoring.commitRectangle();
    } else {
      authoring.cancelRectangle();
    }
    syncEditableRegionAuthoringOverlay();
  }
  if (activeEditTool === "selection") {
    if (event.type === "pointerup" && tileSelection.drafting) {
      tileSelection.finishSelection(world, activeSession.editableRegion);
    } else if (event.type !== "pointerup") {
      tileSelection.cancelDraft();
    }
    tileSelection.finishMove();
    syncTileSelectionOverlay();
    refreshPointerHover();
  }
  const configurationCell = event.type === "pointerup"
    ? pendingConfigurationCell
    : null;
  activePointerId = null;
  activePointerMode = null;
  activeEditTool = null;
  activeWeldPlacement = false;
  pendingPickCell = null;
  pendingConfigurationCell = null;
  lastEditedCell = null;
  lastPointerGridPoint = null;
  canvas.classList.remove("panning");
  navigation.persistActiveSolutionBoard();
  if (configurationCell !== null) {
    openComponentConfiguration(configurationCell);
  }
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
  const point = renderer.gridPointFromClientPoint(event.clientX, event.clientY);
  hoveredCell = renderer.cellFromGridPoint(point);
  hoveredEdge = renderer.edgeFromGridPoint(point);
  if (
    event.shiftKey &&
    event.deltaY !== 0 &&
    adjustHoveredNumericComponent(event.deltaY < 0 ? 1 : -1)
  ) {
    return;
  }
  renderer.zoomAtClientPoint(event.clientX, event.clientY, event.deltaY);
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
    activeSession.editingState.editable
  ) {
    if (event.code === "KeyA") {
      event.preventDefault();
      if (tileSelection.active) {
        commitTileSelection();
      }
      selectSelectionTool();
      tileSelection.beginSelection(0, 0);
      tileSelection.updateSelection(world.width - 1, world.height - 1);
      tileSelection.finishSelection(world, activeSession.editableRegion);
      syncTileSelectionOverlay();
      refreshPointerHover();
      return;
    }
    if (event.code === "KeyC" && tileSelection.active) {
      event.preventDefault();
      copyTileSelection();
      return;
    }
    if (event.code === "KeyX" && tileSelection.active) {
      event.preventDefault();
      copyTileSelection();
      deleteTileSelection();
      return;
    }
    if (event.code === "KeyV" && tileSelection.hasClipboard) {
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
  if (event.code === "KeyQ") {
    event.preventDefault();
    if (hoveredCell !== null) {
      pickTileAt(hoveredCell);
    }
    return;
  }
  if (
    event.code === "KeyE" &&
    hoveredCell !== null &&
    activeSession.editingState.editable &&
    componentConfigurationForKind(world.kindAt(hoveredCell.x, hoveredCell.y)) !== null
  ) {
    event.preventDefault();
    openComponentConfiguration(hoveredCell);
    return;
  }

  if (selectedTool === "selection" && tileSelection.active) {
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
      tileSelection.rotateTo(orientation);
      syncTileSelectionOverlay();
      return;
    }
  }

  if (
    selectedTool === "tile" &&
    TILE_DEFINITIONS[selectedKind].usesOrientation &&
    activeSession.editingState.editable
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
      void testCurrentPuzzleSolution();
    } else {
      setRunning(!running);
    }
  } else if (event.code === "KeyN" && !running && !testingPuzzleSolution) {
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
window.addEventListener("pagehide", () => navigation.persistActiveSolutionBoard());
window.addEventListener("resize", renderPalettePreviews);

function frame(currentTime: number): void {
  const elapsed = Math.min(currentTime - previousFrameTime, 250);
  previousFrameTime = currentTime;
  if (navigation.screen.kind === "main-menu" || navigation.screen.kind === "puzzle-info") {
    requestAnimationFrame(frame);
    return;
  }

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
  refreshTileInspector();
  const animationProgress = easedAnimationProgress(currentTime);
  renderer.render(
    animationDuration === 0 ? null : previousWorld,
    animationProgress,
    currentTime,
  );
  positionSelectionActions();
  requestAnimationFrame(frame);
}

updateTransportState();
navigation.navigatePath(window.location.pathname);
requestAnimationFrame(frame);
