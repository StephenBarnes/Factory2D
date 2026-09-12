import "./styles.css";
import { PuzzlePriceFeedback } from "./ui/puzzle-price-feedback";
import type {
  DevelopmentDiagnosticSnapshot,
  DiagnosticDirection,
} from "./dev/diagnostic-snapshot";
import { NavigationController } from "./game/navigation-controller";
import { SimulationClock } from "./game/simulation-clock";
import {
  clearPlayerData,
  replacePlayerData,
  serializePlayerData,
} from "./game/player-data";
import { SavedSandboxController } from "./game/saved-sandbox-controller";
import { SavedSolutionController } from "./game/saved-solution-controller";
import { PuzzleTestController } from "./game/puzzle-test-controller";
import { parseSandboxImport } from "./game/sandbox-puzzle-authoring";
import { computePuzzleDesignMetrics } from "./game/puzzle-scores";
import { createSandboxWorld, puzzleById, serializeShippedPuzzle } from "./game/puzzles";
import { WorkshopSessionController } from "./game/workshop-session";
import {
  MAX_SNIPPET_NAME_LENGTH,
  restrictSnippetWorld,
  tileKindNames,
} from "./game/snippet-library";
import { SnippetLibraryController } from "./game/snippet-library-controller";
import { WorkshopSurfaceController } from "./game/workshop-surface-controller";
import { copyComponentConfiguration } from "./game/component-configuration-copy";
import type { SelectionPreviewCell } from "./game/tile-selection";

import { visitCrossedGridEdges } from "./render/grid-drag";
import type { GridCell, GridEdge, GridPoint } from "./render/grid-drag";
import { drawTile } from "./render/tile-renderer";
import { componentConfigurationForKind } from "./simulation/configurable-components";
import { serializeBoard } from "./simulation/board-export";
import { PuzzleResult } from "./simulation/puzzle-result";
import type { World } from "./simulation/world";
import { recordWeldAnimation } from "./simulation/weld-animation";
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
import { SignalPanel } from "./ui/signal-panel";
import { ToolCursor } from "./ui/tool-cursor";
import { DropupMenu } from "./ui/dropup-menu";
import { downloadBlob } from "./ui/download";
import {
  SnippetPanel,
  type SnippetCardModel,
  type SnippetPlacementPointer,
} from "./ui/snippet-panel";
import { SignalTraceRecorder } from "./game/signal-traces";
import { TextBoxTool } from "./ui/text-box-tool";
import { populateComponentPalette } from "./ui/component-palette";
import { initializeTheme } from "./ui/theme";
import { initializeBevelSetting } from "./ui/bevel-setting";
import { WorkshopSounds } from "./ui/workshop-sounds";
import { initializePaletteResize } from "./ui/palette-resize";

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
const sandboxInfoScreen = requiredElement<HTMLElement>("sandbox-info-screen");
const puzzleInfoScreen = requiredElement<HTMLElement>("puzzle-info-screen");
const puzzleMap = requiredElement<HTMLElement>("puzzle-map");
const sandboxButton = requiredElement<HTMLButtonElement>("sandbox-button");
const settingsButton = requiredElement<HTMLButtonElement>("settings-button");
const settingsDialog = requiredElement<HTMLDialogElement>("settings-dialog");
const theme = initializeTheme(
  requiredElement<HTMLButtonElement>("light-theme-button"),
  requiredElement<HTMLButtonElement>("workshop-theme-button"),
);
initializeBevelSetting(requiredElement<HTMLButtonElement>("bevels-button"), renderPalettePreviews);
const sounds = new WorkshopSounds(requiredElement<HTMLButtonElement>("sounds-button"));
const exportPlayerDataButton = requiredElement<HTMLButtonElement>("export-player-data-button");
const importPlayerDataButton = requiredElement<HTMLButtonElement>("import-player-data-button");
const importPlayerDataFile = requiredElement<HTMLInputElement>("import-player-data-file");
const clearPlayerDataButton = requiredElement<HTMLButtonElement>("clear-player-data-button");
const aboutButton = requiredElement<HTMLButtonElement>("about-button");
const aboutDialog = requiredElement<HTMLDialogElement>("about-dialog");
const menuButton = requiredElement<HTMLButtonElement>("menu-button");
const screenTitle = requiredElement<HTMLElement>("screen-title");
const workshopInfoButton = requiredElement<HTMLButtonElement>("workshop-info-button");
const workshopInfoDialog = requiredElement<HTMLDialogElement>("workshop-info-dialog");
const puzzleMetrics = requiredElement<HTMLElement>("puzzle-metrics");
const puzzlePrice = requiredElement<HTMLElement>("puzzle-price");
const puzzlePriceFeedback = new PuzzlePriceFeedback(
  requiredElement<HTMLElement>("puzzle-price-change"),
);
const puzzleFootprint = requiredElement<HTMLElement>("puzzle-footprint");
const sidebarControls = requiredElement<HTMLElement>("sidebar-controls");
const componentPalette = requiredElement<HTMLElement>("component-palette");
const inspectorPanel = requiredElement<HTMLElement>("tile-inspector");
const surface = new WorkshopSurfaceController(sessions, canvas, inspectorPanel);
const toolCursor = new ToolCursor(canvas, requiredElement<HTMLElement>("tool-cursor"));
const playButton = requiredElement<HTMLButtonElement>("play-button");
const transportShortcutLabel = requiredElement<HTMLElement>("transport-shortcut-label");
const testReportDialog = requiredElement<HTMLDialogElement>("test-report-dialog");
const fastForwardButton = requiredElement<HTMLButtonElement>("fast-forward-button");
const testCaseMenu = new DropupMenu(
  requiredElement<HTMLElement>("test-case-dropup"),
  requiredElement<HTMLButtonElement>("test-case-button"),
  requiredElement<HTMLElement>("test-case-options"),
);
const testStatusToast = requiredElement<HTMLElement>("test-status-toast");
const componentConfigurationDialogElement = requiredElement<HTMLDialogElement>(
  "component-configuration-dialog",
);
const stepButton = requiredElement<HTMLButtonElement>("step-button");
const resetButton = requiredElement<HTMLButtonElement>("reset-button");
let resetFeedbackAnimation: Animation | null = null;
const clearButton = requiredElement<HTMLButtonElement>("clear-button");
const exportMenu = new DropupMenu(
  requiredElement<HTMLElement>("export-dropup"),
  requiredElement<HTMLButtonElement>("export-button"),
  requiredElement<HTMLElement>("export-options"),
);
const downloadSceneButton = requiredElement<HTMLButtonElement>("download-scene-button");
const copySceneButton = requiredElement<HTMLButtonElement>("copy-scene-button");
const downloadImageButton = requiredElement<HTMLButtonElement>("download-image-button");
const downloadPuzzleButton = requiredElement<HTMLButtonElement>("download-puzzle-button");
const openPuzzleSandboxButton = requiredElement<HTMLButtonElement>("open-puzzle-sandbox-button");
const sharePuzzleButton = requiredElement<HTMLButtonElement>("share-puzzle-button");
const importButton = requiredElement<HTMLButtonElement>("import-button");
const importFile = requiredElement<HTMLInputElement>("import-file");
const animationToggle = requiredElement<HTMLInputElement>("animation-toggle");
const clock = new SimulationClock(5, () => animationToggle.checked);
const speedMenu = new DropupMenu(
  requiredElement<HTMLElement>("speed-dropup"),
  requiredElement<HTMLButtonElement>("speed-button"),
  requiredElement<HTMLElement>("speed-options"),
);
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
const selectionSaveSnippetButton = requiredElement<HTMLButtonElement>(
  "selection-save-snippet-button",
);
const selectionDeleteButton = requiredElement<HTMLButtonElement>("selection-delete-button");
const selectionCropButton = requiredElement<HTMLButtonElement>("selection-crop-button");
const selectionCopyConfigButton = requiredElement<HTMLButtonElement>("selection-copy-config-button");
const selectionPasteConfigButton = requiredElement<HTMLButtonElement>("selection-paste-config-button");
let copiedComponentConfiguration: SelectionPreviewCell | null = null;
const nestedViewBar = requiredElement<HTMLElement>("nested-view-bar");
const nestedViewBackButton = requiredElement<HTMLButtonElement>("nested-view-back-button");
const nestedViewTrail = requiredElement<HTMLElement>("nested-view-trail");
const componentsTab = requiredElement<HTMLButtonElement>("components-tab");
const snippetsTab = requiredElement<HTMLButtonElement>("snippets-tab");
const snippetCount = requiredElement<HTMLElement>("snippet-count");
const snippetPanelElement = requiredElement<HTMLElement>("snippet-panel");
const saveSnippetButton = requiredElement<HTMLButtonElement>("save-snippet-button");
const importSnippetsButton = requiredElement<HTMLButtonElement>("import-snippets-button");
const exportSnippetsButton = requiredElement<HTMLButtonElement>("export-snippets-button");
const importSnippetsFile = requiredElement<HTMLInputElement>("import-snippets-file");
const signalTraces = new SignalTraceRecorder();
let hoveredSignalTileId: number | null = null;
let hoveredSignalWorld: World | null = null;
const signalPanel = new SignalPanel(
  {
    root: requiredElement<HTMLElement>("signal-panel"),
    canvas: requiredElement<HTMLCanvasElement>("signal-panel-canvas"),
    toggleButton: requiredElement<HTMLButtonElement>("signal-panel-toggle"),
  },
  window.localStorage,
  (tileId, world) => {
    hoveredSignalTileId = tileId;
    hoveredSignalWorld = world;
  },
  (lines) => {
    if (!surface.session.editingState.editable) return false;
    const root = surface.session.world;
    const cells = lines.map((line) => {
      if (signalTraces.visibleTileId(root, line.world, line.id) === null) return null;
      for (let index = 0; index < line.world.cellCount; index += 1) {
        if (line.world.idAtIndex(index) !== line.id) continue;
        const state = line.world.componentStateSnapshotAtIndex(index);
        if ((state?.type !== "monitor" && state?.type !== "grapher") ||
          state.category !== line.category) return null;
        return { world: line.world, x: index % line.world.width, y: Math.floor(index / line.world.width) };
      }
      return null;
    });
    if (cells.some((cell) => cell === null)) return false;
    let changed = false;
    cells.forEach((cell, order) => {
      if (cell === null) throw new Error("Reordered signal source disappeared");
      changed = cell.world.configureSignalOrder(cell.x, cell.y, order) || changed;
    });
    if (changed) {
      root.touchRevision();
      commitEditedWorld();
    }
    return true;
  },
);

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
  "text-box": {
    name: "Text box tool",
    description: "Adds free-positioned notes without tiles or cost. Puzzle instructions and labels inside fixed arrays are read-only.",
    controls: "LEFT CLICK ADD / EDIT · LEFT DRAG MOVE · RIGHT CLICK DELETE · ENTER NEWLINE · ESC SAVE / DELETE EMPTY · BOX FITS TEXT",
  },
};

function isInspectorTool(value: string | undefined): value is InspectorTool {
  return value === "weld" || value === "selection" || value === "editable-region" || value === "text-box";
}


type PaletteTab = "components" | "snippets";

let paletteTab: PaletteTab = "components";
let selectedKind = TileKind.Sand;
let previousSelectedKind: TileKind = selectedKind;
let selectedOrientation = Direction.Up;
let selectedTool: BuildTool = "tile";
let previousSelectionTool: BuildTool = "tile";
let temporaryWeldTool: BuildTool | null = null;
let previousFrameTime = performance.now();
let renderedTick = -1;
let renderedPaletteDevicePixelRatio = 0;
let tileKindsByShortcut: Readonly<Record<string, TileKind | undefined>> =
  Object.create(null);
let componentInspectorReferences: readonly (InspectorComponentReference | undefined)[] = [];


function updateTransportState(): void {
  const running = clock.running;
  const editingEnabled = surface.session.editingState.editable;
  const puzzleWorkshop = navigation.screen.kind === "puzzle";
  const testingPuzzleSolution = puzzleTests.testing;
  const testLifecycle = puzzleTests.lifecycle.kind;
  const testFailed = testLifecycle === "failed";
  const testPlaying = testingPuzzleSolution && !puzzleTests.manualStepping;
  playButton.textContent = puzzleWorkshop
    ? testingPuzzleSolution ? testPlaying ? "Ⅱ PAUSE" : "▶ RESUME" : "▶ TEST"
    : running ? "Ⅱ PAUSE" : "▶ RUN";
  playButton.disabled = false;
  playButton.classList.toggle("running", puzzleWorkshop ? testPlaying : running);
  fastForwardButton.hidden = !puzzleWorkshop;
  fastForwardButton.disabled = !puzzleWorkshop;
  testCaseMenu.button.disabled = testingPuzzleSolution;
  stateLight.classList.toggle("running", running || testPlaying);
  stateLight.classList.toggle("failed", testFailed);
  stateLabel.textContent = testingPuzzleSolution
    ? !testPlaying ? "TEST PAUSED"
      : testLifecycle === "between-cases" ? "CASE PASSED" : "TESTING CASE"
    : testFailed ? "TEST FAILED"
    : running ? "SIMULATING" : editingEnabled ? "BUILD MODE" : "RESET TO EDIT";
  stepButton.disabled = running || (testingPuzzleSolution && !puzzleTests.manualStepping);
  clearButton.disabled = !editingEnabled || testingPuzzleSolution;
  transportShortcutLabel.textContent = puzzleWorkshop ? "TEST / PAUSE" : "RUN / PAUSE";
  for (const item of sidebarControls.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.disabled = !editingEnabled || testingPuzzleSolution;
  }
  snippetPanel.setEditable(editingEnabled && !testingPuzzleSolution);
}

function markSimulationStarted(): boolean {
  return sessions.beginSimulation();
}
function refreshPuzzleMetrics(edited = false): void {
  const screen = navigation.screen;
  const puzzleWorkshop = screen.kind === "puzzle";
  puzzleMetrics.hidden = !puzzleWorkshop;
  if (!puzzleWorkshop) {
    puzzlePriceFeedback.update(null, false);
    componentPalette.classList.remove("show-prices");
    return;
  }

  const metrics = computePuzzleDesignMetrics(
    puzzleById(screen.puzzleId),
    surface.session.baseline,
  );
  puzzlePrice.textContent = `${metrics.price}⚙`;
  puzzlePriceFeedback.update(metrics.price, edited);
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
    sounds.edit("place");
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
  clock.setRunning(nextRunning);
  updateTransportState();
  if (editingChanged) {
    refreshPointerHover();
  }
}

surface.setMountListener(() => {
  resetFeedbackAnimation?.cancel();
  resetFeedbackAnimation = null;
  if (selectedTool === "editable-region" && surface.editableRegionAuthoring === null) {
    selectedTool = "tile";
    configureComponentPalette();
  }
  syncTileSelectionOverlay();
  syncEditableRegionAuthoringOverlay();
  refreshSnippetPanel();
  refreshNestedViewBar();
  renderedTick = -1;
  clock.finishAnimation();
  updateTransportState();
  refreshPointerHover();
});

function refreshNestedViewBar(): void {
  const trail = surface.viewTrail;
  nestedViewBar.hidden = trail.length === 0;
  if (trail.length === 0) {
    nestedViewTrail.replaceChildren();
    return;
  }
  const parts: (string | HTMLElement)[] = ["BOARD"];
  for (const entry of trail) {
    parts.push(" › ");
    const label = document.createElement("em");
    label.textContent = `RUNE ARRAY #${entry.id.toString().padStart(4, "0")} ` +
      `${entry.width}×${entry.height}`;
    parts.push(label);
    if (entry.description !== "") {
      parts.push(` “${entry.description}”`);
    }
  }
  nestedViewTrail.replaceChildren(...parts);
}

/** Opens the rune array under the pointer on the displayed board, if any. */
function enterHoveredRuneArray(cell: GridCell): boolean {
  if (surface.world.kindAt(cell.x, cell.y) !== TileKind.RuneArray) {
    return false;
  }
  finalizeActivePointerGesture();
  if (surface.selection.active) {
    commitTileSelection();
  }
  return surface.enterRuneArray(cell);
}

function exitRuneArray(): boolean {
  finalizeActivePointerGesture();
  if (surface.selection.active) {
    commitTileSelection();
  }
  return surface.exitRuneArray();
}

nestedViewBackButton.addEventListener("click", () => {
  exitRuneArray();
});



function finishAnimation(): void {
  surface.session.previousWorld.copyFrom(surface.session.world);
  clock.finishAnimation();
}

function finishAnimationIfDisabled(): void {
  if (!clock.animationsEnabled()) {
    finishAnimation();
  }
}


function advanceSimulation(duration: number, startedAt = performance.now()): void {
  finalizeActiveEditGesture();
  if (surface.selection.active) {
    commitTileSelection();
  }
  if (markSimulationStarted()) {
    updateTransportState();
    refreshPointerHover();
  }
  const session = surface.session;
  session.previousWorld.copyFrom(session.world);
  surface.simulation.step(duration > 0 ? session.previousWorld : undefined);
  signalTraces.sync(session.world, surface.simulation.tick);
  if (session.world.puzzleResult === PuzzleResult.Won) {
    sounds.victory();
  } else if (session.world.puzzleResult === PuzzleResult.Lost) {
    sounds.loss();
  }

  clock.beginAnimation(startedAt, duration);
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
  if (surface.hoveredCell !== null && selectedTool !== "text-box") {
    const kind = surface.world.kindAt(surface.hoveredCell.x, surface.hoveredCell.y);
    surface.inspector.update(surface.hoveredCell, componentInspectorReferences[kind] ?? null);
    return;
  }
  surface.inspector.update(null, null);
}

function refreshPointerHover(): void {
  toolCursor.update(selectedTool, selectedKind, selectedOrientation);
  if (selectedTool === "text-box") {
    surface.renderer.setHover(null);
  } else if (!surface.session.editingState.editable) {
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
    ? surface.editableRegionAuthoring
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
    selectionActive ? surface.selection.draftRegion(surface.editableRegion) : null,
  );
  selectionActions.hidden = overlay === null;
  selectionPasteButton.disabled = !surface.selection.hasClipboard;
  saveSnippetButton.disabled = !surface.selection.active;
  selectionCropButton.hidden = navigation.screen.kind !== "sandbox" || surface.viewDepth !== 0;
  selectionCropButton.disabled = overlay === null || !overlay.valid;
  selectionCopyConfigButton.disabled = overlay === null ||
    singleConfigurationSource(overlay.previewCells) === null;
  const copied = copiedComponentConfiguration;
  selectionPasteConfigButton.disabled = !surface.session.editingState.editable ||
    overlay === null || !overlay.valid || copied === null ||
    !overlay.previewCells.some((cell) => cell.kind === copied.kind);
  selectionPasteConfigButton.title = copied === null
    ? "First select one configurable component and copy its configuration"
    : `Paste ${TILE_DEFINITIONS[copied.kind].name} settings into matching selected components. ` +
      "Copies E-dialog settings only; rune-array resizing may crop contents.";
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
  if (selectedTool === "editable-region" && surface.editableRegionAuthoring === null) {
    selectedTool = "tile";
  }
  const availableComponents = surface.session.availableComponents;
  if (availableComponents !== null && !availableComponents.has(selectedKind)) {
    const firstComponent = availableComponents.entries[0];
    if (firstComponent === undefined) {
      selectedTool = "weld";
    } else {
      selectedKind = firstComponent.kind;
    }
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
  const textBoxButton = sidebarControls.querySelector<HTMLButtonElement>("[data-tool=\"text-box\"]");
  textBoxButton?.classList.toggle("selected", selectedTool === "text-box");
  if (weldButton === null || selectionButton === null || editableRegionButton === null) {
    throw new Error("Tool palette buttons are missing");
  }
  weldButton.classList.toggle("selected", selectedTool === "weld");
  selectionButton.classList.toggle("selected", selectedTool === "selection");
  editableRegionButton.hidden = surface.session.editableRegionAuthoring === null;
  editableRegionButton.classList.toggle("selected", selectedTool === "editable-region");
  syncEditableRegionAuthoringOverlay();
  syncTileSelectionOverlay();
  setPaletteTab(paletteTab);
  refreshSnippetPanel();
}

function setPaletteTab(tab: PaletteTab): void {
  paletteTab = tab;
  const showSnippets = tab === "snippets";
  componentsTab.setAttribute("aria-selected", String(!showSnippets));
  snippetsTab.setAttribute("aria-selected", String(showSnippets));
  componentPalette.hidden = showSnippets;
  snippetPanelElement.hidden = !showSnippets;
  renderPalettePreviews();
}

function refreshSnippetPanel(highlightId: string | null = null): void {
  const boardWidth = surface.world.width;
  const boardHeight = surface.world.height;
  const cards: SnippetCardModel[] = snippets.entries.map(({ snippet, world }) => {
    const warnings: string[] = [];
    let placeable = true;
    if (world.width > boardWidth || world.height > boardHeight) {
      warnings.push(`Larger than this ${boardWidth}×${boardHeight} board.`);
      placeable = false;
    }
    const restricted = restrictSnippetWorld(world, componentIsAvailable);
    if (restricted.world === null) {
      warnings.push("None of its components are available in this workshop.");
      placeable = false;
    } else if (restricted.removedKinds.length > 0) {
      warnings.push(
        `Not available here, placed as empty: ${tileKindNames(restricted.removedKinds).join(", ")}.`,
      );
    }
    return { id: snippet.id, name: snippet.name, world, warnings, placeable };
  });
  snippetCount.textContent = String(cards.length);
  snippetCount.hidden = cards.length === 0;
  exportSnippetsButton.disabled = cards.length === 0;
  snippetPanel.render(cards, highlightId);
}

function saveSelectionAsSnippet(): void {
  const world = surface.selection.captureWorld();
  if (world === null) {
    return;
  }
  const saved = snippets.saveWorld(world);
  if (saved === null) {
    throw new Error("Captured selection unexpectedly contains no tiles");
  }
  setPaletteTab("snippets");
  refreshSnippetPanel(saved.id);
}

function boardCenterGridPoint(): GridPoint {
  const bounds = canvas.getBoundingClientRect();
  return surface.renderer.gridPointFromClientPoint(
    bounds.left + bounds.width / 2,
    bounds.top + bounds.height / 2,
  );
}

/** Floats a snippet as a pasted selection, centered under the pointer or on the visible board. */
function beginSnippetPlacement(id: string, pointer: SnippetPlacementPointer | null): boolean {
  if (!surface.session.editingState.editable) {
    return false;
  }
  const world = restrictSnippetWorld(snippets.byId(id).world, componentIsAvailable).world;
  if (
    world === null ||
    world.width > surface.world.width ||
    world.height > surface.world.height
  ) {
    return false;
  }
  canvasInteraction.cancel();
  if (surface.selection.active) {
    commitTileSelection();
  }
  selectSelectionTool();
  const point = pointer === null
    ? boardCenterGridPoint()
    : surface.renderer.gridPointFromClientPoint(pointer.clientX, pointer.clientY);
  const pointerX = Math.floor(point.x);
  const pointerY = Math.floor(point.y);
  if (!surface.selection.pasteWorld(
    world,
    pointerX - Math.floor(world.width / 2),
    pointerY - Math.floor(world.height / 2),
  )) {
    return false;
  }
  if (pointer !== null) {
    const region = expectDefined(
      surface.selection.overlay(canEditCell, componentIsAvailable)?.region.rectangles[0],
      "Floated snippet region",
    );
    const grabX = Math.max(region.x, Math.min(region.x + region.width - 1, pointerX));
    const grabY = Math.max(region.y, Math.min(region.y + region.height - 1, pointerY));
    if (!surface.selection.beginMove(grabX, grabY)) {
      throw new Error("Floated snippet does not contain its grab cell");
    }
  }
  syncTileSelectionOverlay();
  refreshPointerHover();
  return true;
}

function moveSnippetPlacement(pointer: SnippetPlacementPointer): void {
  const point = surface.renderer.gridPointFromClientPoint(pointer.clientX, pointer.clientY);
  surface.hoveredCell = surface.renderer.cellFromGridPoint(point);
  surface.hoveredEdge = null;
  surface.selection.updateMove(Math.floor(point.x), Math.floor(point.y));
  syncTileSelectionOverlay();
  refreshPointerHover();
}

function finishSnippetPlacement(): void {
  surface.selection.finishMove();
  surface.clearPointerHover();
  syncTileSelectionOverlay();
  refreshPointerHover();
}

function renameSnippet(id: string): void {
  const entry = snippets.byId(id);
  const name = window.prompt(
    `Rename ${entry.snippet.name} (up to ${MAX_SNIPPET_NAME_LENGTH} characters):`,
    entry.snippet.name,
  );
  if (name === null || name === entry.snippet.name) {
    return;
  }
  try {
    snippets.rename(id, name);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
    return;
  }
  refreshSnippetPanel();
}

function deleteSnippet(id: string): void {
  const entry = snippets.byId(id);
  if (!window.confirm(`Delete ${entry.snippet.name}? This cannot be undone.`)) {
    return;
  }
  snippets.delete(id);
  refreshSnippetPanel();
}

function exportSnippet(id: string): void {
  const entry = snippets.byId(id);
  const slug = entry.snippet.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  downloadBlob(
    new Blob([snippets.exportSnippet(id)], { type: "application/json" }),
    `factory2d-snippet-${slug.length === 0 ? entry.snippet.id : slug}.json`,
  );
}

function selectTile(kind: TileKind): void {
  if (!componentIsAvailable(kind)) {
    return;
  }
  if (selectedTool === "text-box") canvasInteraction.cancel();
  if (selectedTool === "selection") {
    commitTileSelection();
  }
  if (kind !== selectedKind) {
    previousSelectedKind = selectedKind;
    selectedKind = kind;
  }
  if (temporaryWeldTool !== null) {
    temporaryWeldTool = "tile";
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
  const { width, height } = surface.world;
  if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) {
    if (
      surface.viewDepth > 0 &&
      ((cell.x === Math.floor(width / 2) && (cell.y === -1 || cell.y === height)) ||
        (cell.y === Math.floor(height / 2) && (cell.x === -1 || cell.x === width)))
    ) {
      selectTile(TileKind.Conduit);
    }
    return;
  }
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
  snippetPanel.redrawThumbnails();

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
  toolCursor.update(selectedTool, selectedKind, selectedOrientation);
}

function setSelectedOrientation(orientation: Direction): void {
  selectedOrientation = orientation;
  renderPalettePreviews();
  refreshPointerHover();
}

function selectWeldTool(): void {
  if (selectedTool === "text-box") canvasInteraction.cancel();
  if (selectedTool === "selection" && temporaryWeldTool === null) {
    commitTileSelection();
  }
  selectedTool = "weld";
  for (const item of sidebarControls.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.classList.toggle("selected", item.dataset.tool === "weld");
  }
  syncEditableRegionAuthoringOverlay();
  syncTileSelectionOverlay();
  refreshPointerHover();
}
function selectSelectionTool(rememberPrevious = true): void {
  if (selectedTool === "text-box") canvasInteraction.cancel();
  const previousTool = temporaryWeldTool ?? selectedTool;
  if (rememberPrevious && previousTool !== "selection") previousSelectionTool = previousTool;
  temporaryWeldTool = null;
  selectedTool = "selection";
  for (const item of sidebarControls.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.classList.toggle("selected", item.dataset.tool === "selection");
  }
  syncEditableRegionAuthoringOverlay();
  syncTileSelectionOverlay();
  refreshPointerHover();
}


function selectEditableRegionTool(): void {
  if (selectedTool === "text-box") canvasInteraction.cancel();
  if (surface.editableRegionAuthoring === null) {
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

function selectTextBoxTool(): void {
  finalizeActivePointerGesture();
  if (selectedTool === "selection") commitTileSelection();
  temporaryWeldTool = null;
  selectedTool = "text-box";
  for (const item of sidebarControls.querySelectorAll<HTMLButtonElement>(".palette-item")) {
    item.classList.toggle("selected", item.dataset.tool === "text-box");
  }
  syncEditableRegionAuthoringOverlay();
  syncTileSelectionOverlay();
  refreshPointerHover();
}

function restoreTool(tool: BuildTool): void {
  switch (tool) {
    case "tile": selectTile(selectedKind); break;
    case "weld": selectWeldTool(); break;
    case "selection": selectSelectionTool(false); break;
    case "text-box": selectTextBoxTool(); break;
    case "editable-region":
      if (surface.editableRegionAuthoring !== null) selectEditableRegionTool();
      else selectTile(selectedKind);
      break;
  }
}

function releaseTemporaryWeld(): void {
  const tool = temporaryWeldTool;
  temporaryWeldTool = null;
  if (tool !== null && selectedTool === "weld") {
    finalizeActivePointerGesture();
    restoreTool(tool);
  }
}

function commitEditedWorld(): void {
  if (surface.viewDepth > 0) {
    surface.session.world.touchRevision();
  }
  sessions.saveEditedBaseline();
  finishAnimation();
  navigation.markActiveWorkshopDirty();
  navigation.persistActiveWorkshop();
  refreshPuzzleMetrics(true);
}

function componentIsAvailable(kind: TileKind): boolean {
  return surface.session.availableComponents?.has(kind) ?? true;
}

function canEditCell(x: number, y: number): boolean {
  return surface.editableRegion?.contains(x, y) ?? true;
}

function canEditEdge(x1: number, y1: number, x2: number, y2: number): boolean {
  return surface.editableRegion?.containsEdge(x1, y1, x2, y2) ?? true;
}

function setAnimatedWeld(x1: number, y1: number, x2: number, y2: number, welded: boolean): boolean {
  if (!surface.world.setWeld(x1, y1, x2, y2, welded)) return false;
  recordWeldAnimation(surface.world, x1, y1, x2, y2);
  return true;
}

function weldEligibleEditableNeighbors(x: number, y: number): boolean {
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
      changed = setAnimatedWeld(x, y, neighborX, neighborY, true) || changed;
    }
  }
  return changed;
}

function rejectLockedEdit(): void {
  resetFeedbackAnimation?.cancel();
  resetFeedbackAnimation = resetButton.animate(
    [
      { boxShadow: "0 0 0 3px #e15a4f", backgroundColor: "#a52e26", offset: 0 },
      { boxShadow: "0 0 0 3px #e15a4f", backgroundColor: "#a52e26", offset: 0.35 },
      { boxShadow: "0 0 0 0 transparent", offset: 1 },
    ],
    { duration: 700, easing: "ease-out" },
  );
}

function editCellLine(
  from: GridCell,
  to: GridCell,
  erase: boolean,
  weldPlacedTiles: boolean,
): boolean {
  if (!surface.session.editingState.editable) {
    rejectLockedEdit();
    return false;
  }
  if (!erase && !componentIsAvailable(selectedKind)) {
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
  let previousX = x;
  let tilesChanged = false;
  let previousY = y;
  const orientation = orientationForKind(selectedKind, selectedOrientation);

  while (true) {
    const editable = canEditCell(x, y);
    if (editable) {
      if (
        surface.world.kindAt(x, y) !== kind ||
        (
          kind !== TileKind.Empty &&
          surface.world.orientationAt(x, y) !== orientation
        )
      ) {
        surface.world.place(x, y, kind, orientation);
        changed = true;
        tilesChanged = true;
      }
      if (weldPlacedTiles && kind !== TileKind.Empty) {
        changed = weldEligibleEditableNeighbors(x, y) || changed;
      }
    }
    if (!editable) surface.renderer.flashRejectedRegion();
    if (
      !erase &&
      (x !== previousX || y !== previousY) &&
      canEditEdge(previousX, previousY, x, y)
    ) {
      changed = setAnimatedWeld(previousX, previousY, x, y, true) || changed;
    }
    if (x === to.x && y === to.y) {
      break;
    }
    previousX = x;
    previousY = y;
    if (!erase) {
      // Visit one edge at a time, including a deterministic staircase at corners.
      const crossedX = Math.abs(x - from.x);
      const crossedY = Math.abs(y - from.y);
      if ((2 * crossedX + 1) * deltaY <= (2 * crossedY + 1) * deltaX) {
        x += stepX;
      } else {
        y += stepY;
      }
      continue;
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

  if (changed) sounds.edit(erase ? "remove" : tilesChanged ? "place" : "weld");
  return changed;
}
function openComponentConfiguration(cell: GridCell): void {
  if (!surface.session.editingState.editable) {
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
    canEditCell(cell.x, cell.y) ? (submission: ComponentConfigurationSubmission) => {
      if (
        !surface.session.editingState.editable ||
        !canEditCell(cell.x, cell.y) ||
        surface.world.idAt(cell.x, cell.y) !== tileId ||
        surface.world.kindAt(cell.x, cell.y) !== kind
      ) {
        return;
      }
      const changed = submission.type === "number"
        ? surface.world.configureNumericComponent(cell.x, cell.y, submission.value)
        : submission.type === "text"
        ? surface.world.configureSignalLabel(cell.x, cell.y, submission.value, submission.category)
        : submission.type === "array"
        ? surface.world.configureRuneArray(
            cell.x,
            cell.y,
            submission.width,
            submission.height,
            submission.description,
          )
        : surface.world.configureTernaryGrid(
            cell.x,
            cell.y,
            submission.width,
            submission.height,
            submission.values,
            submission.ignoreZeros,
          );
      if (changed) {
        commitEditedWorld();
        refreshPointerHover();
      }
      if (submission.type === "array" && submission.open) {
        enterHoveredRuneArray(cell);
      }
    } : null,
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
    (state?.type !== "delay" && state?.type !== "counter" && state?.type !== "discard")
  ) {
    return false;
  }
  const currentValue = state.type === "delay" ? state.length : state.type === "counter" ? state.threshold : state.length;
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


function setEditableWeld(x1: number, y1: number, x2: number, y2: number, erase: boolean): boolean {
  if (!canEditEdge(x1, y1, x2, y2)) {
    surface.renderer.flashRejectedRegion();
    return false;
  }
  if (!erase && !surface.world.canWeld(x1, y1, x2, y2)) {
    surface.renderer.flashRejectedWeld(x1, y1, x2, y2);
    return false;
  }
  return setAnimatedWeld(x1, y1, x2, y2, !erase);
}

function editWeld(edge: GridEdge, erase: boolean): boolean {
  if (!surface.session.editingState.editable) {
    rejectLockedEdit();
    return false;
  }
  if (surface.selection.active) commitTileSelection();
  const changed = setEditableWeld(edge.x1, edge.y1, edge.x2, edge.y2, erase);
  if (changed) sounds.edit(erase ? "unweld" : "weld");
  return changed;
}

function editWeldSegment(
  from: GridPoint,
  to: GridPoint,
  endpointEdge: GridEdge | null,
  erase: boolean,
): boolean {
  if (!surface.session.editingState.editable) {
    rejectLockedEdit();
    return false;
  }
  if (surface.selection.active) commitTileSelection();

  let changed = false;
  visitCrossedGridEdges(from, to, surface.world.width, surface.world.height, (x1, y1, x2, y2) => {
    changed = setEditableWeld(x1, y1, x2, y2, erase) || changed;
  });
  if (endpointEdge !== null) {
    changed = setEditableWeld(
      endpointEdge.x1,
      endpointEdge.y1,
      endpointEdge.x2,
      endpointEdge.y2,
      erase,
    ) || changed;
  }
  if (changed) sounds.edit(erase ? "unweld" : "weld");
  return changed;
}
const componentConfigurationView = new ComponentConfigurationDialog(
  componentConfigurationDialogElement,
);
const textBoxTool = new TextBoxTool(
  surface,
  requiredElement<HTMLDialogElement>("text-box-dialog"),
  commitEditedWorld,
);
const canvasInteraction = new CanvasInteractionController(surface, {
  getSelectedTool: () => selectedTool,
  textBoxTool,
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
  rejectLockedEdit,
});
surface.setInteractionCanceler(() => {
  cancelPalettePlacement();
  canvasInteraction.cancel();
  textBoxTool.cancel();
  snippetPanel.cancelPlacement();
});
const snippets = new SnippetLibraryController(window.localStorage);
const snippetPanel = new SnippetPanel(
  {
    root: snippetPanelElement,
    list: requiredElement<HTMLElement>("snippet-list"),
    emptyMessage: requiredElement<HTMLElement>("snippet-empty"),
  },
  {
    beginPlacement: beginSnippetPlacement,
    movePlacement: moveSnippetPlacement,
    finishPlacement: finishSnippetPlacement,
    rename: renameSnippet,
    remove: deleteSnippet,
    exportSnippet,
  },
);
function prepareForRuntimeChange(): void {
  cancelPalettePlacement();
  finalizeActivePointerGesture();
  if (surface.selection.active) {
    commitTileSelection();
  }
}

const puzzleTests = new PuzzleTestController(
  { caseMenu: testCaseMenu, statusToast: testStatusToast, reportDialog: testReportDialog },
  {
    getBaseline: () => surface.session.baseline,
    prepareForRuntimeChange,
    resetSession: () => sessions.resetSimulation(),
    beginSimulation: () => {
      sessions.beginSimulation();
    },
    mountRuntime: (world, simulation) => {
      surface.mountActiveSession({
        fitBoard: false,
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
      const session = surface.session;
      session.previousWorld.copyFrom(session.world);
      return session.previousWorld;
    },
    afterStep: (world, tick) => {
      signalTraces.sync(world, tick);
    },
    onSuccess: () => sounds.victory(),
    onFailure: () => sounds.loss(),
    setStepAnimation: (startedAt, duration) => clock.beginAnimation(startedAt, duration),
    finishAnimation,
    animationsEnabled: (ticksPerSecond) => clock.animationsEnabled(ticksPerSecond),
    recordResult: (scores) => navigation.recordActivePuzzleTestResult(scores),
    refreshTransport: updateTransportState,
    refreshHover: refreshPointerHover,
    leaveWorkshop: () => navigation.leaveWorkshop(),
    getNextPuzzle: () => navigation.nextPuzzle,
    openPuzzle: (puzzleId) => navigation.navigate({ kind: "puzzle-info", puzzleId }),
  },
);

function stopWorkshopActivity(): void {
  prepareForRuntimeChange();
  puzzleTests.stop();
  componentConfigurationView.close();
  exportMenu.close();
  speedMenu.close();
  toolCursor.hide();
  setRunning(false);
}
function configureSandboxTestCaseMenu(): void {
  if (navigation.screen.kind !== "sandbox") {
    return;
  }
  const authoring = surface.session.puzzleAuthoring;
  if (authoring === null) {
    throw new Error("Sandbox puzzle authoring state is missing");
  }

  testCaseMenu.options.replaceChildren();
  for (const testCase of authoring.testCases) {
    const option = document.createElement("button");
    option.type = "button";
    option.textContent = testCase.name;
    option.dataset.testCaseId = testCase.id;
    const selected = testCase.id === authoring.selectedTestCaseId;
    option.setAttribute("aria-pressed", String(selected));
    option.addEventListener("click", () => {
      testCaseMenu.close();
      if (testCase.id === authoring.selectedTestCaseId) {
        return;
      }
      changeSandboxTestCase(() => sessions.selectActiveSandboxTestCase(testCase.id));
    });
    testCaseMenu.options.append(option);
  }

  const actions = document.createElement("div");
  actions.className = "test-case-authoring-actions";
  const duplicate = document.createElement("button");
  duplicate.type = "button";
  duplicate.textContent = "DUPLICATE CURRENT";
  duplicate.addEventListener("click", () => {
    testCaseMenu.close();
    changeSandboxTestCase(() => sessions.duplicateActiveSandboxTestCase());
  });
  const selected = authoring.testCases.find(
    ({ id }) => id === authoring.selectedTestCaseId,
  );
  if (selected === undefined) {
    throw new Error(`Selected sandbox test case "${authoring.selectedTestCaseId}" is missing`);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "DELETE CURRENT";
  remove.disabled = selected.standard;
  remove.title = selected.standard ? "The standard test case cannot be deleted" : "";
  remove.addEventListener("click", () => {
    testCaseMenu.close();
    changeSandboxTestCase(() => sessions.deleteActiveSandboxTestCase());
  });
  actions.append(duplicate, remove);
  testCaseMenu.options.append(actions);

  testCaseMenu.container.hidden = false;
  testCaseMenu.button.textContent = `CASE: ${selected.name}`;
  testCaseMenu.button.title = "Choose, duplicate, or delete a sandbox puzzle test case";
  testCaseMenu.button.disabled = false;
  testCaseMenu.close();
}

function changeSandboxTestCase(updateSession: () => void): void {
  stopWorkshopActivity();
  surface.mountActiveSession({
    fitBoard: false,
    cancelInteraction: true,
    updateSession,
  });
  navigation.markActiveWorkshopDirty();
  navigation.persistActiveWorkshop();
  configureSandboxTestCaseMenu();
  updateTransportState();
  refreshPointerHover();
}


const savedSolutions = new SavedSolutionController(window.localStorage);
const savedSandboxes = new SavedSandboxController(window.localStorage);
const navigation = new NavigationController(
  {
    gameScreen,
    mainMenuScreen,
    sandboxInfoScreen,
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
      if (screen.kind === "sandbox") {
        configureSandboxTestCaseMenu();
      }
      updateTransportState();
      importButton.hidden = screen.kind !== "sandbox";
      importButton.disabled = surface.session.editableRegion !== null;
      updateExportOptionsForSession();
    },
    onSandboxPropertiesChanged: (properties) => {
      const dimensionsChanged = properties.width !== surface.session.world.width ||
        properties.height !== surface.session.world.height;
      if (!dimensionsChanged) {
        sessions.updateActiveSandboxProperties(properties);
        navigation.markActiveWorkshopDirty();
        navigation.persistActiveWorkshop();
        return;
      }
      stopWorkshopActivity();
      surface.mountActiveSession({
        fitBoard: true,
        cancelInteraction: true,
        updateSession: () => {
          sessions.updateActiveSandboxProperties(properties);
        },
      });
      navigation.markActiveWorkshopDirty();
      navigation.persistActiveWorkshop();
      configureComponentPalette();
      updateTransportState();
      refreshPointerHover();
    },
  },
  sessions,
  savedSolutions,
  savedSandboxes,
  window.localStorage,
  window.history,
);

if (import.meta.env.DEV) {
  const getDiagnosticSnapshot = (): DevelopmentDiagnosticSnapshot => {
    const screen = navigation.screen;
    const rootWorld = surface.session.world;
    const puzzleResult = rootWorld.puzzleResult === PuzzleResult.InProgress
      ? "in-progress"
      : rootWorld.puzzleResult === PuzzleResult.Won ? "won" : "lost";
    return {
      screen: { ...screen },
      activePuzzleId: screen.kind === "puzzle-info" || screen.kind === "puzzle"
        ? screen.puzzleId
        : null,
      activeSolutionId: screen.kind === "puzzle" ? screen.solutionId : null,
      simulation: {
        running: clock.running || puzzleTests.testing,
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
        : selectedTool === "text-box"
        ? { kind: "text-box" }
        : {
          kind: "tile",
          tileKind: TILE_DEFINITIONS[selectedKind].name,
          orientation: DIAGNOSTIC_DIRECTIONS[selectedOrientation],
        },
      hoveredCell: surface.hoveredCell === null ? null : { ...surface.hoveredCell },
      view: {
        depth: surface.viewDepth,
        width: surface.world.width,
        height: surface.world.height,
        editable: surface.editableRegion === null,
      },
      worldRevision: rootWorld.revision,
      serializedBoard: serializeBoard(rootWorld, surface.simulation.tick),
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
  navigation.navigate({ kind: "sandbox-info" });
});
const unlockAllPuzzlesButton = requiredElement<HTMLButtonElement>("unlock-all-puzzles-button");
unlockAllPuzzlesButton.setAttribute("aria-pressed", String(navigation.allPuzzlesUnlocked));
unlockAllPuzzlesButton.addEventListener("click", () => {
  try {
    navigation.setAllPuzzlesUnlocked(!navigation.allPuzzlesUnlocked);
    unlockAllPuzzlesButton.setAttribute("aria-pressed", String(navigation.allPuzzlesUnlocked));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.alert(`Could not save puzzle unlock setting: ${message}`);
  }
});
settingsButton.addEventListener("click", () => {
  settingsDialog.showModal();
});
exportPlayerDataButton.addEventListener("click", () => {
  try {
    downloadBlob(
      new Blob([serializePlayerData(window.localStorage)], { type: "application/json" }),
      "factory2d-player-data.json",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.alert(`Could not export player data: ${message}`);
  }
});
importPlayerDataButton.addEventListener("click", () => {
  importPlayerDataFile.click();
});
importPlayerDataFile.addEventListener("change", async () => {
  const file = importPlayerDataFile.files?.[0];
  importPlayerDataFile.value = "";
  if (file === undefined) {
    return;
  }
  if (!window.confirm("Importing will replace all player data on this device. Continue?")) {
    return;
  }

  importPlayerDataButton.disabled = true;
  try {
    replacePlayerData(window.localStorage, await file.text());
    settingsDialog.close();
    window.location.reload();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.alert(`Could not import player data: ${message}`);
  } finally {
    importPlayerDataButton.disabled = false;
  }
});
clearPlayerDataButton.addEventListener("click", () => {
  if (
    !window.confirm(
      "Clear all saved puzzle progress, solutions, sandboxes, snippets, and settings? This cannot be undone.",
    )
  ) {
    return;
  }
  try {
    clearPlayerData(window.localStorage);
    settingsDialog.close();
    window.location.reload();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.alert(`Could not clear player data: ${message}`);
  }
});
aboutButton.addEventListener("click", () => {
  aboutDialog.showModal();
});

let palettePointerId: number | null = null;

function cancelPalettePlacement(): void {
  const pointerId = palettePointerId;
  palettePointerId = null;
  if (pointerId !== null && sidebarControls.hasPointerCapture(pointerId)) {
    sidebarControls.releasePointerCapture(pointerId);
  }
  if (pointerId !== null) {
    surface.clearPointerHover();
    refreshPointerHover();
  }
}

sidebarControls.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".palette-item");
  if (button === null || button.disabled) return;
  if (event.button === 1) {
    event.preventDefault();
    cancelPalettePlacement();
    button.click();
    return;
  }
  const kind = Number(button.dataset.tile);
  if (!isTileKind(kind) || TILE_DEFINITIONS[kind].palette === null) return;
  event.preventDefault();
  cancelPalettePlacement();
  canvasInteraction.cancel();
  selectTile(kind);
  if (selectedTool === "tile") {
    palettePointerId = event.pointerId;
    sidebarControls.setPointerCapture(event.pointerId);
  }
});

sidebarControls.addEventListener("pointermove", (event) => {
  if (event.pointerId !== palettePointerId) return;
  if ((event.buttons & 1) === 0) {
    cancelPalettePlacement();
    return;
  }
  surface.hoveredPaletteButton = null;
  const overCanvas = document.elementFromPoint(event.clientX, event.clientY) === canvas;
  surface.hoveredCell = overCanvas
    ? surface.renderer.cellFromGridPoint(
      surface.renderer.gridPointFromClientPoint(event.clientX, event.clientY),
    )
    : null;
  surface.hoveredEdge = null;
  refreshPointerHover();
});

sidebarControls.addEventListener("pointerup", (event) => {
  if (event.pointerId !== palettePointerId || event.button !== 0) return;
  cancelPalettePlacement();
  if (selectedTool !== "tile" || document.elementFromPoint(event.clientX, event.clientY) !== canvas) return;
  const cell = surface.renderer.cellFromGridPoint(
    surface.renderer.gridPointFromClientPoint(event.clientX, event.clientY),
  );
  if (cell === null) return;
  const configure = surface.world.kindAt(cell.x, cell.y) !== selectedKind &&
    componentConfigurationForKind(selectedKind)?.configureOnPlacement === true;
  if (editCellLine(cell, cell, false, event.shiftKey)) {
    commitEditedWorld();
    if (configure) openComponentConfiguration(cell);
  }
});
sidebarControls.addEventListener("pointercancel", cancelPalettePlacement);
sidebarControls.addEventListener("lostpointercapture", cancelPalettePlacement);
sidebarControls.addEventListener("auxclick", (event) => {
  if (event.button === 1) event.preventDefault();
});
window.addEventListener("blur", cancelPalettePlacement);

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
  } else if (button?.dataset.tool === "text-box") {
    selectTextBoxTool();
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
    sounds.edit("remove");
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

function singleConfigurationSource(cells: readonly SelectionPreviewCell[]): SelectionPreviewCell | null {
  let source: SelectionPreviewCell | null = null;
  for (const cell of cells) {
    if (componentConfigurationForKind(cell.kind) === null) continue;
    if (source !== null) return null;
    source = cell;
  }
  return source;
}

selectionCopyConfigButton.addEventListener("click", () => {
  const overlay = surface.selection.overlay(canEditCell, componentIsAvailable);
  if (overlay === null) return;
  const source = singleConfigurationSource(overlay.previewCells);
  if (source === null) return;
  copiedComponentConfiguration = source;
  syncTileSelectionOverlay();
});

selectionPasteConfigButton.addEventListener("click", () => {
  if (!surface.session.editingState.editable) return;
  const source = copiedComponentConfiguration;
  const overlay = surface.selection.overlay(canEditCell, componentIsAvailable);
  if (source === null || overlay === null || !overlay.valid) return;
  const state = source.componentState;
  if (state === null) throw new Error("Copied component configuration is missing");
  const result = surface.selection.commit(surface.world, canEditCell, componentIsAvailable);
  if (!result.accepted) {
    syncTileSelectionOverlay();
    return;
  }
  let changed = result.changed;
  for (const cell of overlay.previewCells) {
    changed = copyComponentConfiguration(surface.world, cell.x, cell.y, source.kind, state) || changed;
  }
  if (changed) commitEditedWorld();
  syncTileSelectionOverlay();
  refreshPointerHover();
});

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
selectionSaveSnippetButton.addEventListener("click", saveSelectionAsSnippet);
selectionDeleteButton.addEventListener("click", deleteTileSelection);
selectionCropButton.addEventListener("click", () => {
  if (navigation.screen.kind !== "sandbox" || surface.viewDepth !== 0) return;
  const overlay = surface.selection.overlay(canEditCell, componentIsAvailable);
  if (overlay === null || !overlay.valid) return;
  const bounds = expectDefined(overlay.region.rectangles[0], "Crop selection bounds are missing");
  if (!window.confirm(
    "Crop the board to this selection? Everything outside it will be removed from all test cases.",
  )) return;
  commitTileSelection();
  stopWorkshopActivity();
  surface.mountActiveSession({
    fitBoard: true,
    cancelInteraction: true,
    updateSession: () => sessions.cropActiveSandbox(bounds),
  });
  navigation.markActiveWorkshopDirty();
  navigation.persistActiveWorkshop();
  configureComponentPalette();
  updateTransportState();
  refreshPointerHover();
});
saveSnippetButton.addEventListener("click", saveSelectionAsSnippet);
componentsTab.addEventListener("click", () => {
  setPaletteTab("components");
});
snippetsTab.addEventListener("click", () => {
  setPaletteTab("snippets");
});
exportSnippetsButton.addEventListener("click", () => {
  if (snippets.count === 0) {
    return;
  }
  downloadBlob(
    new Blob([snippets.exportAll()], { type: "application/json" }),
    "factory2d-snippets.json",
  );
});
importSnippetsButton.addEventListener("click", () => {
  importSnippetsFile.click();
});
importSnippetsFile.addEventListener("change", async () => {
  const file = importSnippetsFile.files?.[0];
  importSnippetsFile.value = "";
  if (file === undefined) {
    return;
  }
  importSnippetsButton.disabled = true;
  try {
    const added = snippets.importFile(await file.text());
    refreshSnippetPanel(added.at(-1)?.id ?? null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.alert(`Could not import snippets: ${message}`);
  } finally {
    importSnippetsButton.disabled = false;
  }
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
    puzzleTests.togglePlayback();
  } else {
    setRunning(!clock.running);
  }
});

fastForwardButton.addEventListener("click", () => {
  puzzleTests.fastForward();
});

testCaseMenu.button.addEventListener("click", () => {
  testCaseMenu.toggle();
});

stepButton.addEventListener("click", () => {
  const duration = clock.manualStepDuration;
  if (navigation.screen.kind === "puzzle") {
    puzzleTests.step(duration);
  } else {
    advanceSimulation(duration);
  }
});
animationToggle.addEventListener("change", finishAnimationIfDisabled);

speedMenu.button.addEventListener("click", () => {
  speedMenu.toggle();
});
const speedButtons = [...speedMenu.options.querySelectorAll<HTMLButtonElement>("[data-speed]")];
for (const button of speedButtons) {
  button.addEventListener("click", () => {
    clock.setTicksPerSecond(Number(button.dataset.speed));
    speedMenu.button.textContent = `SPEED: ${button.textContent}`;
    for (const option of speedButtons) {
      option.setAttribute("aria-pressed", String(option === button));
    }
    finishAnimationIfDisabled();
    speedMenu.close();
    speedMenu.button.focus();
  });
}
speedMenu.container.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && speedMenu.open) {
    event.preventDefault();
    event.stopPropagation();
    speedMenu.close();
    speedMenu.button.focus();
  } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const wasClosed = !speedMenu.open;
    speedMenu.setOpen(true);
    const current = speedButtons.indexOf(document.activeElement as HTMLButtonElement);
    const selected = speedButtons.findIndex(
      (button) => Number(button.dataset.speed) === clock.ticksPerSecond,
    );
    const index = event.key === "Home" ? 0
      : event.key === "End" ? speedButtons.length - 1
      : wasClosed || current < 0 ? selected
      : (current + (event.key === "ArrowDown" ? 1 : -1) + speedButtons.length) % speedButtons.length;
    expectDefined(speedButtons[index], "Speed option is missing").focus();
  } else if (speedMenu.open && event.key !== "Tab") {
    event.stopPropagation();
  }
});
speedMenu.container.addEventListener("focusout", (event) => {
  if (!speedMenu.contains(event.relatedTarget)) {
    speedMenu.close();
  }
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
  finalizeActivePointerGesture();
  const preserveTextBoxes = surface.session.puzzleAuthoring === null;
  const retainedTextBoxes = preserveTextBoxes
    ? surface.world.textBoxes.filter((box) => box.owner === "author")
    : [];
  if (surface.selection.active) {
    commitTileSelection();
  }
  if (surface.editableRegion === null) {
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
  if (surface.viewDepth === 0 || surface.editableRegion === null) {
    surface.world.setTextBoxes(retainedTextBoxes);
  }
  commitEditedWorld();
});

function updateExportOptionsForSession(): void {
  const sandboxOnly = surface.session.editableRegion === null;
  downloadPuzzleButton.hidden = false;
  openPuzzleSandboxButton.hidden = sandboxOnly;
  sharePuzzleButton.hidden = !sandboxOnly;
  sharePuzzleButton.disabled = true;
  if (!sandboxOnly) {
    exportMenu.close();
  }
}

exportMenu.button.addEventListener("click", () => {
  exportMenu.toggle();
});

downloadSceneButton.addEventListener("click", () => {
  exportMenu.close();
  const source = serializeBoard(surface.session.world, surface.simulation.tick);
  downloadBlob(new Blob([source], { type: "application/json" }), "factory2d-scene.json");
});

copySceneButton.addEventListener("click", () => {
  exportMenu.close();
  const source = serializeBoard(surface.session.world, surface.simulation.tick);
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
  exportMenu.close();
  surface.renderer.render(surface.previousWorld, 1, performance.now(), theme.isLight);
  surface.renderer.cropRenderedBoard().toBlob((blob) => {
    if (blob === null) {
      throw new Error("Could not encode the grid image as PNG");
    }
    downloadBlob(blob, "factory2d-grid.png");
  }, "image/png");
});

downloadPuzzleButton.addEventListener("click", () => {
  exportMenu.close();
  const screen = navigation.screen;
  if (screen.kind === "puzzle") {
    downloadBlob(
      new Blob([serializeShippedPuzzle(screen.puzzleId)], { type: "application/json" }),
      `${screen.puzzleId}.json`,
    );
    return;
  }
  const regionAuthoring = surface.session.editableRegionAuthoring;
  const puzzleAuthoring = surface.session.puzzleAuthoring;
  if (regionAuthoring === null || puzzleAuthoring === null) {
    throw new Error("Sandbox puzzle authoring state is missing");
  }
  const source = puzzleAuthoring.serialize(regionAuthoring.region);
  downloadBlob(
    new Blob([source], { type: "application/json" }),
    puzzleAuthoring.fileName,
  );
});

openPuzzleSandboxButton.addEventListener("click", () => {
  const screen = navigation.screen;
  if (screen.kind !== "puzzle") {
    return;
  }
  exportMenu.close();
  finalizeActivePointerGesture();
  const sandbox = savedSandboxes.createFromPuzzle(screen.puzzleId);
  navigation.navigate({ kind: "sandbox", sandboxId: sandbox.id });
});

document.addEventListener("click", (event) => {
  for (const menu of [speedMenu, exportMenu, testCaseMenu]) {
    if (!menu.contains(event.target)) {
      menu.close();
    }
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
    const imported = parseSandboxImport(await file.text(), file.name);
    surface.mountActiveSession({
      fitBoard: true,
      cancelInteraction: true,
      updateSession: () => sessions.replaceActiveSandboxImport(imported),
    });
    navigation.markActiveWorkshopDirty();
    navigation.persistActiveWorkshop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.alert(`Could not import file: ${message}`);
  } finally {
    importButton.disabled = surface.session.editableRegion !== null;
  }
});

function finalizeActiveEditGesture(): void {
  snippetPanel.cancelPlacement();
  textBoxTool.cancel();
  canvasInteraction.prepareSimulationStep();
}

function finalizeActivePointerGesture(): boolean {
  snippetPanel.cancelPlacement();
  textBoxTool.cancel();
  return canvasInteraction.cancel();
}

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const point = surface.renderer.gridPointFromClientPoint(event.clientX, event.clientY);
  surface.hoveredCell = surface.renderer.cellFromGridPoint(point);
  surface.hoveredEdge = surface.renderer.edgeFromGridPoint(point);
  if (event.shiftKey) {
    if (event.deltaY === 0) return;
    if (adjustHoveredNumericComponent(event.deltaY < 0 ? 1 : -1)) return;
    const buttons = [...componentPalette.querySelectorAll<HTMLButtonElement>("[data-tile]")];
    if (buttons.length === 0) return;
    const current = buttons.findIndex((button) => Number(button.dataset.tile) === selectedKind);
    const direction = event.deltaY > 0 ? 1 : -1;
    const index = current < 0
      ? (direction > 0 ? 0 : buttons.length - 1)
      : (current + direction + buttons.length) % buttons.length;
    const button = expectDefined(buttons[index], "Palette cycle target is missing");
    const kind = Number(button.dataset.tile);
    if (!isTileKind(kind)) throw new Error("Palette cycle target has invalid tile metadata");
    selectTile(kind);
    button.scrollIntoView({ block: "nearest" });
    return;
  }
  surface.renderer.zoomAtClientPoint(event.clientX, event.clientY, event.deltaY);
  refreshPointerHover();
}, { passive: false });

document.addEventListener("keydown", (event) => {
  if (textBoxTool.open || event.isComposing || event.keyCode === 229) return;
  if (exportMenu.open) {
    if (event.key === "Escape") {
      event.preventDefault();
      exportMenu.close();
      exportMenu.button.focus();
      return;
    }
    if (exportMenu.contains(event.target)) {
      return;
    }
  }
  if (
    (navigation.screen.kind !== "sandbox" && navigation.screen.kind !== "puzzle") ||
    testReportDialog.open ||
    componentConfigurationView.open
  ) {
    return;
  }
  const textEntryTarget =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement ||
    (event.target instanceof HTMLElement && event.target.isContentEditable);
  if (event.key === "Control") {
    if (!event.repeat && !textEntryTarget && selectedTool !== "weld" && temporaryWeldTool === null) {
      finalizeActivePointerGesture();
      temporaryWeldTool = selectedTool;
      selectWeldTool();
    }
    return;
  }
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
      surface.selection.selectOccupiedBounds(surface.world, surface.editableRegion);
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
  const transportSpace =
    event.code === "Space" &&
    (event.target === speedMenu.button || event.target === animationToggle);
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    (textEntryTarget && !transportSpace)
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
  if (event.code === "KeyV") {
    event.preventDefault();
    if (!event.repeat) {
      if (selectedTool === "selection") restoreTool(previousSelectionTool);
      else selectSelectionTool();
    }
    return;
  }
  if (event.code === "KeyQ") {
    event.preventDefault();
    if (surface.hoveredCell !== null) {
      pickTileAt(surface.hoveredCell);
    }
    return;
  }
  if (event.code === "Enter" || event.code === "NumpadEnter") {
    if (surface.selection.active) {
      event.preventDefault();
      finalizeActivePointerGesture();
      commitTileSelection();
      refreshPointerHover();
    } else if (
      (surface.hoveredCell !== null && enterHoveredRuneArray(surface.hoveredCell)) ||
      exitRuneArray()
    ) {
      event.preventDefault();
    }
    return;
  }
  if (event.key === "Escape") {
    if (exitRuneArray()) {
      event.preventDefault();
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
    if (event.repeat) {
      return;
    }
    if (navigation.screen.kind === "puzzle") {
      puzzleTests.togglePlayback();
    } else {
      setRunning(!clock.running);
    }
  } else if (
    event.code === "KeyN" ||
    event.code === "KeyR" ||
    event.code === "KeyF"
  ) {
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    const button = event.code === "KeyN" ? stepButton
      : event.code === "KeyR" ? resetButton : fastForwardButton;
    if (!button.hidden && !button.disabled) {
      button.click();
    }
  } else {
    const shortcutKind = tileKindsByShortcut[event.code];
    if (shortcutKind !== undefined) {
      selectTile(shortcutKind);
    }
  }
});

document.addEventListener("keyup", (event) => {
  if (event.key === "Control") releaseTemporaryWeld();
});

window.addEventListener("blur", () => {
  finalizeActivePointerGesture();
  releaseTemporaryWeld();
});
window.addEventListener("popstate", () => {
  navigation.navigatePath(window.location.pathname);
});
window.addEventListener("pagehide", () => {
  if (!finalizeActivePointerGesture()) {
    navigation.persistActiveWorkshop();
  }
});
window.addEventListener("resize", renderPalettePreviews);


function frame(currentTime: number): void {
  const elapsed = Math.min(currentTime - previousFrameTime, 250);
  previousFrameTime = currentTime;
  if (navigation.screen.kind === "main-menu" ||
      navigation.screen.kind === "sandbox-info" ||
      navigation.screen.kind === "puzzle-info") {
    requestAnimationFrame(frame);
    return;
  }
  puzzleTests.advanceFrame(currentTime, elapsed);


  clock.advance(currentTime, elapsed, advanceSimulation);
  const devicePixelRatio = window.devicePixelRatio || 1;
  if (renderedPaletteDevicePixelRatio !== devicePixelRatio) {
    renderPalettePreviews();
  }

  if (renderedTick !== surface.simulation.tick) {
    tickCounter.textContent = `TICK ${surface.simulation.tick.toString().padStart(4, "0")}`;
    renderedTick = surface.simulation.tick;
  }
  surface.refreshView();
  refreshTileInspector();
  signalTraces.sync(surface.session.world, surface.simulation.tick);
  signalPanel.update(signalTraces, surface.session.world, surface.simulation.tick);
  surface.renderer.setHighlightedTileId(
    signalTraces.visibleTileId(surface.world, hoveredSignalWorld, hoveredSignalTileId),
  );
  const animationProgress = clock.easedProgress(currentTime);
  surface.renderer.render(
    clock.animating ? surface.previousWorld : null,
    animationProgress,
    currentTime,
    theme.isLight,
  );
  positionSelectionActions();
  requestAnimationFrame(frame);
}

updateTransportState();
navigation.navigatePath(window.location.pathname);
initializePaletteResize(
  gameScreen,
  sidebarControls,
  requiredElement<HTMLElement>("palette-resize-handle"),
  renderPalettePreviews,
);
requestAnimationFrame(frame);
