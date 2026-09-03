import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { DevelopmentDiagnosticSnapshot } from "../src/dev/diagnostic-snapshot";
import { PUZZLE_SOLUTIONS_STORAGE_KEY } from "../src/game/puzzle-solutions";
import { seedBrowserStorage } from "./browser-fixtures";

async function diagnosticSnapshot(page: Page): Promise<DevelopmentDiagnosticSnapshot> {
  await expect.poll(() =>
    page.evaluate(() => typeof window.factory2dDiagnostics)
  ).toBe("object");
  return page.evaluate(() => {
    const diagnostics = window.factory2dDiagnostics;
    if (diagnostics === undefined) {
      throw new Error("Development diagnostics are not installed");
    }
    return diagnostics.snapshot();
  });
}

async function boardCellCenter(
  page: Page,
  x: number,
  y: number,
): Promise<{ readonly x: number; readonly y: number }> {
  return page.evaluate(({ cellX, cellY }) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
    const diagnostics = window.factory2dDiagnostics;
    if (canvas === null || diagnostics === undefined) {
      throw new Error("Workshop layout or diagnostics are incomplete");
    }

    const canvasBounds = canvas.getBoundingClientRect();
    const board = JSON.parse(diagnostics.snapshot().serializedBoard) as {
      readonly width: number;
      readonly height: number;
    };
    const cellSize = Math.min(
      canvas.clientWidth / board.width,
      canvas.clientHeight / board.height,
      64,
    );
    const originX = (canvas.clientWidth - board.width * cellSize) / 2;
    const originY = (canvas.clientHeight - board.height * cellSize) / 2;
    return {
      x: canvasBounds.left + originX + (cellX + 0.5) * cellSize,
      y: canvasBounds.top + originY + (cellY + 0.5) * cellSize,
    };
  }, { cellX: x, cellY: y });
}

async function canvasBlackSpacePoint(
  page: Page,
): Promise<{ readonly x: number; readonly y: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
    const diagnostics = window.factory2dDiagnostics;
    if (canvas === null || diagnostics === undefined) {
      throw new Error("Workshop layout or diagnostics are incomplete");
    }
    const canvasBounds = canvas.getBoundingClientRect();
    const board = JSON.parse(diagnostics.snapshot().serializedBoard) as {
      readonly width: number;
      readonly height: number;
    };
    const cellSize = Math.min(
      canvas.clientWidth / board.width,
      canvas.clientHeight / board.height,
      64,
    );
    const horizontalMargin = (canvas.clientWidth - board.width * cellSize) / 2;
    const verticalMargin = (canvas.clientHeight - board.height * cellSize) / 2;
    if (horizontalMargin > 1) {
      return {
        x: canvasBounds.left + horizontalMargin / 2,
        y: canvasBounds.top + canvas.clientHeight / 2,
      };
    }
    if (verticalMargin > 1) {
      return {
        x: canvasBounds.left + canvas.clientWidth / 2,
        y: canvasBounds.top + verticalMargin / 2,
      };
    }
    throw new Error("Canvas has no black space outside the grid");
  });
}

async function placeStone(page: Page, x: number, y: number): Promise<void> {
  await page.getByRole("button", { name: /^Stone/ }).click();
  let point = await boardCellCenter(page, x, y);
  await expect.poll(async () => {
    point = await boardCellCenter(page, x, y);
    await page.mouse.move(point.x, point.y);
    return (await diagnosticSnapshot(page)).hoveredCell;
  }).toEqual({ x, y });
  await page.mouse.click(point.x, point.y);
}

test("selection shortcuts use occupied bounds and grid clicks unselect", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/sandbox");
  await page.getByRole("button", { name: "Selection tool" }).click();

  await page.keyboard.press("Control+A");
  const selectionActions = page.locator("#selection-actions");
  await expect(selectionActions).toBeVisible();
  await expect(page.getByRole("button", { name: "Flip selection vertically" })).toBeVisible();

  const outsideOccupiedBounds = await boardCellCenter(page, 19, 0);
  await page.mouse.click(outsideOccupiedBounds.x, outsideOccupiedBounds.y);
  await expect(selectionActions).toBeHidden();
});

test("routes only to accessible canonical screens", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/puzzles/first-shift");
  await expect(page.getByRole("heading", { name: "First Shift" })).toBeVisible();
  await expect(page).toHaveURL(/\/puzzles\/first-shift$/);
  expect((await diagnosticSnapshot(page)).screen).toEqual({
    kind: "puzzle-info",
    puzzleId: "first-shift",
  });

  await page.goto("/puzzles/beltworks");
  await expect(page.getByRole("heading", { name: "Factory 2D" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/not-a-route");
  await expect(page).toHaveURL(/\/$/);
});

test("opens settings and credits from the main menu", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/");

  await page.getByRole("button", { name: "SETTINGS" }).click();
  const settings = page.getByRole("dialog", { name: "SETTINGS" });
  await expect(settings).toBeVisible();
  await expect(settings).toContainText("TODO: Add settings.");
  await settings.getByRole("button", { name: "CLOSE" }).click();

  await page.getByRole("button", { name: "CREDITS" }).click();
  const credits = page.getByRole("dialog", { name: "CREDITS" });
  await expect(credits).toBeVisible();
  await expect(credits).toContainText("TODO: Add credits and architecture overview.");
  await expect(credits.getByRole("link", { name: "VIEW SOURCE ON GITHUB" })).toHaveAttribute(
    "href",
    "https://github.com/StephenBarnes/Factory2D",
  );
});

test("edge panels reserve a non-overlapping canvas region", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/sandbox");

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
      const sidebar = document.querySelector<HTMLElement>("#sidebar-controls");
      const controls = document.querySelector<HTMLElement>("#bottom-controls");
      const identity = document.querySelector<HTMLElement>(".workshop-identity");
      if (canvas === null || sidebar === null || controls === null || identity === null) {
        throw new Error("Workshop layout is incomplete");
      }

      const canvasBounds = canvas.getBoundingClientRect();
      const sidebarBounds = sidebar.getBoundingClientRect();
      const controlsBounds = controls.getBoundingClientRect();
      const identityBounds = identity.getBoundingClientRect();
      return {
        canvasWidth: canvasBounds.width,
        canvasHeight: canvasBounds.height,
        canvasLeftGap: canvasBounds.left - sidebarBounds.right,
        canvasBottomGap: controlsBounds.top - canvasBounds.bottom,
        canvasTop: canvasBounds.top,
        canvasRightGap: window.innerWidth - canvasBounds.right,
        controlsBottomGap: window.innerHeight - controlsBounds.bottom,
        controlsLeft: controlsBounds.left,
        sidebarLeft: sidebarBounds.left,
        sidebarTop: sidebarBounds.top,
        sidebarBottomGap: controlsBounds.top - sidebarBounds.bottom,
        identityLeftGap: identityBounds.left - controlsBounds.left,
        identityBottomGap: controlsBounds.bottom - identityBounds.bottom,
      };
    });

    expect(layout.canvasWidth).toBeGreaterThan(0);
    expect(layout.canvasHeight).toBeGreaterThan(0);
    expect(Math.abs(layout.canvasLeftGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.canvasBottomGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.canvasTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.canvasRightGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.controlsBottomGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.sidebarLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.sidebarTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.controlsLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.sidebarBottomGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.identityLeftGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.identityBottomGap)).toBeLessThanOrEqual(1);
  }
});

test("workshop identity exposes information and live puzzle metrics", async ({ page }) => {
  await seedBrowserStorage(page, "populated");
  await page.goto("/puzzles/first-shift/solutions/solution-1");

  const controls = page.locator("#bottom-controls");
  const identity = controls.locator(".workshop-identity");
  const metrics = identity.locator("#puzzle-metrics");
  const price = identity.locator("#puzzle-price");
  const palette = page.locator("#component-palette");
  await expect(identity.locator("#screen-title")).toHaveText("FIRST SHIFT");
  await expect(metrics).toHaveText("0⚙ | 0×0");
  await expect(page.locator("#screen-description")).toHaveCount(0);

  await identity.getByRole("button", { name: "Workshop information" }).click();
  const dialog = page.locator("#workshop-info-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "First Shift" })).toBeVisible();
  await expect(dialog.locator("[data-workshop-info-description]")).toHaveText(
    "Tutorial puzzle teaching block placement",
  );
  await expect(dialog.locator("[data-workshop-info-goal]")).toHaveText(
    "Drop one stone block into the delivery box",
  );
  await dialog.getByRole("button", { name: "CLOSE" }).click();

  await price.hover();
  await expect(palette).toHaveClass(/show-prices/);
  const stoneButton = page.getByRole("button", { name: /^Stone/ });
  await expect.poll(async () =>
    stoneButton.evaluate((element) => getComputedStyle(element, "::after").content)
  ).toContain("1⚙");

  await placeStone(page, 8, 3);
  await expect(metrics).toHaveText("1⚙ | 1×1");
  await expect(palette).not.toHaveClass(/show-prices/);

  await page.goto("/sandbox");
  await expect(page.locator("#puzzle-metrics")).toBeHidden();
  await expect(page.locator("#screen-title")).toHaveText("SANDBOX");
  await page.getByRole("button", { name: "Puzzle properties" }).click();
  await expect(dialog.getByRole("textbox", { name: "ID" })).toHaveValue("untitled-puzzle");
  await expect(dialog.getByRole("combobox", { name: "GROUP" })).toHaveValue("basics");
  await expect(dialog.getByRole("spinbutton", { name: "ORDER" })).toHaveValue("0");
  await expect(dialog.getByRole("textbox", { name: "PUZZLE NAME" })).toHaveValue(
    "Untitled Puzzle",
  );
  await expect(dialog.getByRole("textbox", { name: "DESCRIPTION" })).toHaveValue(
    "TODO: Describe the puzzle setup.",
  );
  await expect(dialog.getByRole("textbox", { name: "GOAL" })).toHaveValue(
    "TODO: Describe the victory condition.",
  );
  await expect(dialog.getByRole("spinbutton", { name: "CYCLE LIMIT" })).toHaveValue("");
  await expect(
    dialog.locator(".workshop-properties-component-group").getByRole("heading"),
  ).toHaveText([
    "Raw Materials",
    "Mechanisms",
    "Circuit Components",
    "Puzzle Tools",
  ]);
  await dialog.getByRole("button", { name: "Disable all Raw Materials" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Sand" })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Stone" })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Conveyor Belt" })).toBeChecked();
  await dialog.getByRole("button", { name: "Enable all Raw Materials" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Sand" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Stone" })).toBeChecked();
  await expect(dialog.locator("[data-workshop-info-goal-panel]")).toBeHidden();
});

test("sandbox test-case menu duplicates, switches, and deletes independent boards", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/sandbox");

  const caseButton = page.getByRole("button", { name: "CASE: Standard case" });
  await expect(caseButton).toBeVisible();
  await placeStone(page, 0, 0);
  await caseButton.click();
  await page.getByRole("button", { name: "DUPLICATE CURRENT" }).click();
  await expect(page.getByRole("button", { name: "CASE: Case 1" })).toBeVisible();

  await placeStone(page, 1, 0);
  await page.getByRole("button", { name: "CASE: Case 1" }).click();
  await page.getByRole("button", { name: "Standard case", exact: true }).click();
  let board = JSON.parse((await diagnosticSnapshot(page)).serializedBoard) as {
    readonly grid: readonly string[];
  };
  expect(board.grid[0]?.slice(0, 2)).toBe("#.");

  await page.getByRole("button", { name: "CASE: Standard case" }).click();
  await page.getByRole("button", { name: "Case 1", exact: true }).click();
  board = JSON.parse((await diagnosticSnapshot(page)).serializedBoard) as {
    readonly grid: readonly string[];
  };
  expect(board.grid[0]?.slice(0, 2)).toBe("##");

  await page.getByRole("button", { name: "CASE: Case 1" }).click();
  await page.getByRole("button", { name: "DELETE CURRENT" }).click();
  await expect(page.getByRole("button", { name: "CASE: Standard case" })).toBeVisible();
  await page.getByRole("button", { name: "CASE: Standard case" }).click();
  await expect(page.getByRole("button", { name: "Case 1", exact: true })).toHaveCount(0);
});

test("tile inspector follows palette, tool, and occupied-board hover", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/sandbox");

  const inspector = page.locator("#tile-inspector");
  const inspectorName = inspector.locator("[data-inspector-name]");
  const inspectorPosition = inspector.locator("[data-inspector-position]");
  const inspectorHint = inspector.locator("[data-inspector-hint]");
  const sandButton = page.getByRole("button", { name: /^Sand/ });
  await sandButton.hover();
  await expect(inspectorName).toHaveText("SAND");
  await expect(inspectorPosition).toBeHidden();
  await expect(inspector.locator("[data-inspector-price]")).toHaveText("0 ⚙");
  await expect(inspector.locator("[data-inspector-shortcut]")).toHaveText("1");
  await expect(inspector).not.toContainText("PALETTE COMPONENT");
  await expect(inspector).toContainText("Falls downward and can fall diagonally around obstacles");

  await placeStone(page, 10, 8);
  await sandButton.click();
  const occupiedCell = await boardCellCenter(page, 10, 8);
  await page.mouse.move(occupiedCell.x, occupiedCell.y);
  await expect(inspectorName).toHaveText("STONE");
  await expect(inspectorPosition).toHaveText(/X 10\s+Y 08\s+ID #\d{4}/);
  await expect(inspectorHint).toHaveText("Solid block affected by gravity");
  await expect(inspector.locator("[data-inspector-price]")).toHaveText("0 ⚙");
  await expect(inspector.locator("[data-inspector-shortcut]")).toHaveText("2");
  for (const removedLabel of [
    "TILE ID",
    "MOVEMENT",
    "WELDABLE",
    "WELDS",
    "MAGNETIC",
    "ORIENTATION",
    "CIRCUIT",
    "CHARGE",
  ]) {
    await expect(inspector.getByText(removedLabel, { exact: true })).toHaveCount(0);
  }

  const visibleInspectorBounds = await inspector.boundingBox();
  if (visibleInspectorBounds === null) {
    throw new Error("Inspector is not visible over an occupied cell");
  }
  await page.mouse.move(
    visibleInspectorBounds.x + visibleInspectorBounds.width / 2,
    visibleInspectorBounds.y + visibleInspectorBounds.height / 2,
  );
  await expect(inspector).toHaveAttribute("aria-hidden", "true");

  await page.mouse.move(occupiedCell.x, occupiedCell.y);
  await expect(inspectorName).toHaveText("STONE");
  const blackSpace = await canvasBlackSpacePoint(page);
  await page.mouse.move(blackSpace.x, blackSpace.y);
  await expect(inspector).toHaveAttribute("aria-hidden", "true");

  const weldTool = page.getByRole("button", { name: "Weld tool (hold Control)" });
  await weldTool.hover();
  await expect(inspectorName).toHaveText("WELD TOOL");
  await expect(inspectorPosition).toHaveText("PALETTE TOOL");
  await expect(inspector).toContainText("Joins adjacent occupied tiles into rigid bodies.");
  await expect(inspector).toContainText("LEFT CLICK / DRAG WELD");
  await expect(inspector).toContainText("RIGHT CLICK / DRAG UNWELD");

  const editableRegionTool = page.getByRole("button", { name: "Editable region tool" });
  await editableRegionTool.hover();
  await expect(inspectorName).toHaveText("EDITABLE REGION TOOL");
  await expect(inspector).toContainText("LEFT DRAG ADD RECTANGLE");

  const sidebarBounds = await page.locator("#sidebar-controls").boundingBox();
  const inspectorBounds = await inspector.boundingBox();
  if (sidebarBounds === null || inspectorBounds === null) {
    throw new Error("Inspector layout is not visible");
  }
  expect(Math.abs(inspectorBounds.x - sidebarBounds.width - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(inspectorBounds.y - 18)).toBeLessThanOrEqual(1);
});

test("puzzle groups show gemstone progression and default collapse states", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/");

  const gemstoneCount = page.locator(".gemstone-count");
  const basics = page.locator(".puzzle-group").filter({ hasText: "Basics" });
  const runelore = page.locator(".puzzle-group").filter({ hasText: "Runelore" });
  await expect(gemstoneCount).toHaveText("0◈");
  await expect(gemstoneCount).toHaveAttribute(
    "title",
    "Gemstones are earned by completing puzzles and automatically unlock new puzzle groups.",
  );
  await expect(basics).toHaveJSProperty("open", true);
  await expect(basics).toHaveCSS("border-color", "rgb(246, 207, 126)");
  await expect(runelore).toHaveJSProperty("open", false);
  await expect(runelore.locator(".puzzle-group-status")).toHaveText(
    "🔒 SOLVE 2 MORE PUZZLES TO UNLOCK",
  );
  await expect(page.getByRole("button", { name: /First Shift/ })).toBeEnabled();
  const runeloreButtons = runelore.locator("button");
  await expect(runeloreButtons).not.toHaveCount(0);
  for (const button of await runeloreButtons.all()) {
    await expect(button).toBeDisabled();
    await expect(button.locator(".puzzle-status")).toHaveText("🔒 LOCKED");
  }
});

test("unlocked fixture opens a gemstone-gated group and puzzle", async ({ page }) => {
  await seedBrowserStorage(page, "unlocked");
  await page.goto("/");

  const basics = page.locator(".puzzle-group").filter({ hasText: "Basics" });
  const runelore = page.locator(".puzzle-group").filter({ hasText: "Runelore" });
  await expect(page.locator(".gemstone-count")).toHaveText("2◈");
  await expect(basics).toHaveJSProperty("open", false);
  await expect(basics).toHaveCSS("border-color", "rgb(138, 106, 58)");
  await expect(runelore).toHaveJSProperty("open", true);

  const conduits = page.getByRole("button", { name: /Conduits/ });
  await expect(conduits).toBeEnabled();
  await conduits.click();
  await expect(page).toHaveURL(/\/puzzles\/conduits$/);
});

test("creates, edits, persists, and restores a solution on reload", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/puzzles/first-shift");
  await page.getByRole("button", { name: "+ NEW SOLUTION" }).click();
  await expect(page).toHaveURL(/\/puzzles\/first-shift\/solutions\/solution-1$/);

  const initial = await diagnosticSnapshot(page);
  expect(initial.activeSolutionId).toBe("solution-1");
  await placeStone(page, 8, 3);
  const edited = await diagnosticSnapshot(page);
  expect(edited.worldRevision).toBeGreaterThan(initial.worldRevision);
  expect(edited.serializedBoard).not.toBe(initial.serializedBoard);

  await page.reload();
  const restored = await diagnosticSnapshot(page);
  expect(restored.serializedBoard).toBe(edited.serializedBoard);
  expect(restored.activeSolutionId).toBe("solution-1");

  const storedBoard = await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === null) {
      throw new Error("Saved-solution storage is missing");
    }
    const stored = JSON.parse(serialized) as {
      readonly solutions: readonly { readonly id: string; readonly board: string }[];
    };
    return stored.solutions.find((solution) => solution.id === "solution-1")?.board;
  }, PUZZLE_SOLUTIONS_STORAGE_KEY);
  expect(storedBoard).toBe(edited.serializedBoard);
});

test("commits multi-event tile drags once on pointer up or cancellation", async ({ page }) => {
  await seedBrowserStorage(page, "populated");
  await page.goto("/puzzles/first-shift/solutions/solution-1");
  await page.getByRole("button", { name: /^Stone/ }).click();

  const canvas = page.locator("#game-canvas");
  await page.evaluate((storageKey) => {
    const canvasElement = document.querySelector<HTMLCanvasElement>("#game-canvas");
    if (canvasElement === null) {
      throw new Error("Game canvas is missing");
    }
    canvasElement.dataset.solutionStorageWrites = "0";
    canvasElement.addEventListener("pointerdown", (event) => {
      canvasElement.dataset.testPointerId = String(event.pointerId);
    });
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string): void {
      if (key === storageKey) {
        const writes = Number(canvasElement.dataset.solutionStorageWrites);
        canvasElement.dataset.solutionStorageWrites = String(writes + 1);
      }
      originalSetItem.call(this, key, value);
    };
  }, PUZZLE_SOLUTIONS_STORAGE_KEY);

  const firstStart = await boardCellCenter(page, 8, 3);
  const firstEnd = await boardCellCenter(page, 11, 3);
  await page.mouse.move(firstStart.x, firstStart.y);
  await page.mouse.down();
  await page.mouse.move(firstEnd.x, firstEnd.y, { steps: 8 });
  const liveFirstGrid = JSON.parse((await diagnosticSnapshot(page)).serializedBoard) as {
    readonly grid: readonly string[];
  };
  expect(liveFirstGrid.grid[3]?.slice(8, 12)).toBe("####");
  await expect(canvas).toHaveAttribute("data-solution-storage-writes", "0");

  await page.mouse.up();
  await expect(canvas).toHaveAttribute("data-solution-storage-writes", "1");

  await canvas.evaluate((element) => {
    element.dataset.solutionStorageWrites = "0";
  });
  const secondStart = await boardCellCenter(page, 8, 4);
  const secondEnd = await boardCellCenter(page, 11, 4);
  await page.mouse.move(secondStart.x, secondStart.y);
  await page.mouse.down();
  await page.mouse.move(secondEnd.x, secondEnd.y, { steps: 8 });
  await canvas.evaluate((element) => {
    const pointerId = Number(element.dataset.testPointerId);
    element.dispatchEvent(new PointerEvent("pointercancel", {
      bubbles: true,
      pointerId,
      pointerType: "mouse",
    }));
  });
  await expect(canvas).toHaveAttribute("data-solution-storage-writes", "1");
  await page.mouse.up();
  await expect(canvas).toHaveAttribute("data-solution-storage-writes", "1");

  const storedGrid = await page.evaluate((storageKey) => {
    const serializedSolutions = window.localStorage.getItem(storageKey);
    if (serializedSolutions === null) {
      throw new Error("Saved-solution storage is missing");
    }
    const stored = JSON.parse(serializedSolutions) as {
      readonly solutions: readonly { readonly id: string; readonly board: string }[];
    };
    const solution = stored.solutions.find((candidate) => candidate.id === "solution-1");
    if (solution === undefined) {
      throw new Error("Edited solution is missing");
    }
    const board: { readonly grid: readonly string[] } = JSON.parse(solution.board);
    return board.grid;
  }, PUZZLE_SOLUTIONS_STORAGE_KEY);
  expect(storedGrid[3]?.slice(8, 12)).toBe("####");
  expect(storedGrid[4]?.slice(8, 12)).toBe("####");
});

test("renders puzzle cases and leaves the failed case paused on the board", async ({ page }) => {
  await seedBrowserStorage(page, "populated");
  await page.goto("/puzzles/first-shift/solutions/solution-1");

  const testButton = page.getByRole("button", { name: "◆ TEST" });
  const fastForwardButton = page.getByRole("button", { name: "≫ FAST" });
  const report = page.getByRole("dialog");
  await expect(testButton).toBeVisible();
  await expect(page.getByRole("button", { name: /RUN/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "CASE: Standard case" })).toBeVisible();
  await page.getByRole("button", { name: "CASE: Standard case" }).click();
  await expect(page.getByRole("button", { name: "Standard case", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Standard case", exact: true }).click();
  await testButton.click();

  await expect(fastForwardButton).toBeVisible();
  await expect.poll(async () => (await diagnosticSnapshot(page)).simulation.tick).toBeGreaterThan(0);
  await fastForwardButton.click();

  await expect(report).not.toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    "Failed: test case \"Standard case\" reached cycle limit 10",
  );
  await expect(page.locator("#tick-counter")).toHaveText("TICK 0010");
  await expect(page.locator("#state-label")).toHaveText("TEST FAILED");
  await expect(fastForwardButton).not.toBeVisible();

  await page.getByRole("button", { name: "RESET" }).click();
  await expect(page.getByRole("status")).not.toBeVisible();
  await expect(page.locator("#tick-counter")).toHaveText("TICK 0000");
  await expect(page.locator("#state-label")).toHaveText("BUILD MODE");

  await page.locator("#menu-button").click();
  await expect(page).toHaveURL(/\/puzzles\/first-shift$/);

  await page.goto("/sandbox");
  await expect(page.getByRole("button", { name: "▶ RUN" })).toBeVisible();
  await expect(report).not.toBeVisible();
});

test("persists successful solution scores on the puzzle briefing", async ({ page }) => {
  await seedBrowserStorage(page, "populated");
  await page.goto("/puzzles/first-shift/solutions/solution-1");
  await placeStone(page, 9, 3);
  await page.getByRole("button", { name: "◆ TEST" }).click();
  await page.getByRole("button", { name: "≫ FAST" }).click();

  const report = page.getByRole("dialog");
  await expect(report.getByRole("heading", { name: "ALL TESTS PASSED" })).toBeVisible();
  await expect(report.locator("[data-test-report-price]")).toHaveText("1");
  await expect(report.locator("[data-test-report-cycles]")).toHaveText("9");
  await expect(report.locator("[data-test-report-footprint]")).toHaveText("1");
  await expect(report.locator("[data-test-report-combined]")).toHaveText("11");

  await report.getByRole("button", { name: "BACK TO PUZZLE" }).click();
  const scoredSolution = page.locator("#solution-list").getByRole("listitem").filter({
    has: page.locator(".solution-identity strong", { hasText: "Solution 1" }),
  });
  await expect(scoredSolution).toBeVisible();
  await expect(scoredSolution).toContainText("Confirmed successful");
  await expect(scoredSolution.locator(".solution-scores strong")).toHaveText(["1", "9", "1", "11"]);
  await expect(scoredSolution).toHaveClass(/best-score/);
  await page.reload();
  await expect(scoredSolution).toBeVisible();
  await expect(scoredSolution).toHaveClass(/best-score/);
});

test("highlights only the confirmed solution with the lowest combined score", async ({ page }) => {
  await seedBrowserStorage(page, "populated");
  await page.goto("/puzzles/first-shift");
  await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === null) {
      throw new Error("Saved-solution storage is missing");
    }
    const stored = JSON.parse(serialized) as {
      solutions: Array<{
        id: string;
        scores: {
          price: number;
          cycles: number;
          footprint: number;
          combined: number;
        } | null;
      }>;
    };
    const first = stored.solutions.find(({ id }) => id === "solution-1");
    const second = stored.solutions.find(({ id }) => id === "solution-2");
    if (first === undefined || second === undefined) {
      throw new Error("Scored-solution fixture is incomplete");
    }
    first.scores = { price: 4, cycles: 10, footprint: 2, combined: 16 };
    second.scores = { price: 3, cycles: 5, footprint: 1, combined: 9 };
    window.localStorage.setItem(storageKey, JSON.stringify(stored));
  }, PUZZLE_SOLUTIONS_STORAGE_KEY);
  await page.reload();

  const rows = page.locator("#solution-list").getByRole("listitem");
  await expect(rows.filter({ hasText: "Solution 1" })).not.toHaveClass(/best-score/);
  await expect(rows.filter({ hasText: "Solution 2" })).toHaveClass(/best-score/);
});


test("duplicates an edited board into an independent restorable solution", async ({ page }) => {
  const fixture = await seedBrowserStorage(page, "edited-board");
  await page.goto("/puzzles/first-shift");
  const firstSolution = page.locator("#solution-list").getByRole("listitem").filter({
    hasText: "Solution 1",
  });
  await firstSolution.getByRole("button", { name: "Duplicate Solution 1" }).click();

  const solutionRows = page.locator("#solution-list").getByRole("listitem");
  await expect(solutionRows).toHaveCount(2);
  const duplicateRow = solutionRows.filter({ hasText: "Solution 1 Copy" });
  await expect(duplicateRow).toBeVisible();
  await duplicateRow.getByRole("button", { name: "Edit Solution 1 Copy" }).click();
  const duplicate = await diagnosticSnapshot(page);
  expect(duplicate.activeSolutionId).toBe("solution-2");
  expect(duplicate.serializedBoard).toBe(fixture.editedBoard);

  await page.reload();
  expect((await diagnosticSnapshot(page)).serializedBoard).toBe(fixture.editedBoard);
});

test("deletes a solution from its row and keeps it deleted after reload", async ({ page }) => {
  await seedBrowserStorage(page, "populated");
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/puzzles/first-shift");
  const solutionRows = page.locator("#solution-list").getByRole("listitem");
  await expect(solutionRows).toHaveCount(2);
  const firstSolution = solutionRows.filter({ hasText: "Solution 1" });
  await firstSolution.getByRole("button", { name: "Delete Solution 1" }).click();
  await expect(solutionRows).toHaveCount(1);
  await expect(solutionRows.filter({ hasText: "Solution 2" })).toBeVisible();

  await page.reload();
  await expect(solutionRows).toHaveCount(1);
  await expect(solutionRows.filter({ hasText: /^Solution 1$/ })).toHaveCount(0);
});

test("malformed storage falls back to a usable empty state", async ({ page }) => {
  await seedBrowserStorage(page, "malformed-storage");
  await page.goto("/puzzles/first-shift");
  await expect(page.getByText("No saved solutions. Create one to enter the workshop.")).toBeVisible();
  await page.getByRole("button", { name: "+ NEW SOLUTION" }).click();
  await expect(page).toHaveURL(/\/solutions\/solution-1$/);
});

test("export dropup exposes scene actions and sandbox puzzle authoring", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/sandbox");
  await page.getByRole("button", { name: "Puzzle properties" }).click();
  const propertiesDialog = page.locator("#workshop-info-dialog");
  await propertiesDialog.getByRole("textbox", { name: "ID" }).fill("authored-puzzle");
  await propertiesDialog.getByRole("combobox", { name: "GROUP" }).selectOption("runelore");
  await propertiesDialog.getByRole("spinbutton", { name: "ORDER" }).fill("12.5");
  await propertiesDialog.getByRole("textbox", { name: "PUZZLE NAME" }).fill("Authored Puzzle");
  await propertiesDialog.getByRole("textbox", { name: "DESCRIPTION" }).fill(
    "Authored in the sandbox.",
  );
  await propertiesDialog.getByRole("textbox", { name: "GOAL" }).fill(
    "Deliver the authored mechanism.",
  );
  await propertiesDialog.getByRole("spinbutton", { name: "CYCLE LIMIT" }).fill("321");
  await propertiesDialog.getByRole("spinbutton", { name: "WIDTH" }).fill("22");
  await propertiesDialog.getByRole("spinbutton", { name: "HEIGHT" }).fill("15");
  await propertiesDialog.getByRole("checkbox", { name: "Sand" }).uncheck();
  await propertiesDialog.getByRole("spinbutton", { name: "Stone price" }).fill("9");
  await propertiesDialog.getByRole("button", { name: "SAVE" }).click();
  expect((await diagnosticSnapshot(page)).view).toMatchObject({ width: 22, height: 15 });


  const editableRegionTool = page.getByRole("button", { name: "Editable region tool" });
  await editableRegionTool.click();
  expect((await diagnosticSnapshot(page)).selectedTool).toEqual({ kind: "editable-region" });

  const firstStart = await boardCellCenter(page, 2, 3);
  const firstEnd = await boardCellCenter(page, 5, 7);
  await page.mouse.move(firstStart.x, firstStart.y);
  await page.mouse.down();
  await page.mouse.move(firstEnd.x, firstEnd.y);
  await page.mouse.up();

  const secondStart = await boardCellCenter(page, 10, 1);
  const secondEnd = await boardCellCenter(page, 11, 2);
  await page.mouse.move(secondStart.x, secondStart.y);
  await page.mouse.down();
  await page.mouse.move(secondEnd.x, secondEnd.y);
  await page.mouse.up();

  const removePoint = await boardCellCenter(page, 3, 4);
  await page.mouse.click(removePoint.x, removePoint.y, { button: "right" });
  await placeStone(page, 0, 0);
  const sandboxBoard = JSON.parse((await diagnosticSnapshot(page)).serializedBoard) as {
    readonly grid: readonly string[];
  };
  expect(sandboxBoard.grid[0]?.[0]).toBe("#");


  const exportButton = page.getByRole("button", { name: "EXPORT" });
  await exportButton.click();
  await expect(exportButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "DOWNLOAD SCENE FILE" })).toBeVisible();
  await expect(page.getByRole("button", { name: "COPY SCENE TO CLIPBOARD" })).toBeVisible();
  await expect(page.getByRole("button", { name: "DOWNLOAD IMAGE" })).toBeVisible();
  await expect(page.getByRole("button", { name: "DOWNLOAD PUZZLE FILE" })).toBeVisible();
  await expect(page.getByRole("button", { name: "SHARE PUZZLE" })).toBeDisabled();

  const puzzleDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD PUZZLE FILE" }).click();
  const puzzleDownload = await puzzleDownloadPromise;
  expect(puzzleDownload.suggestedFilename()).toBe("authored-puzzle.json");
  const puzzleDownloadPath = await puzzleDownload.path();
  if (puzzleDownloadPath === null) {
    throw new Error("Puzzle download did not produce a local file");
  }
  const puzzleFile = JSON.parse(await readFile(puzzleDownloadPath, "utf8")) as {
    readonly name: string;
    readonly description: string;
    readonly id: string;
    readonly group: string;
    readonly order: number;
    readonly goal: string;
    readonly cycleLimit: number;
    readonly width: number;
    readonly height: number;
    readonly components: readonly { readonly code: string; readonly price: number }[];
    readonly editableRegions: readonly unknown[];
  };
  expect(puzzleFile).toMatchObject({
    id: "authored-puzzle",
    group: "runelore",
    order: 12.5,
    name: "Authored Puzzle",
    description: "Authored in the sandbox.",
    goal: "Deliver the authored mechanism.",
    cycleLimit: 321,
    width: 22,
    height: 15,
  });
  expect(puzzleFile.components).not.toContainEqual({ code: ":", price: 1 });
  expect(puzzleFile.components).toContainEqual({ code: "#", price: 9 });
  expect(puzzleFile.editableRegions).toEqual([{ x: 10, y: 1, width: 2, height: 2 }]);

  await exportButton.click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD SCENE FILE" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("factory2d-scene.json");
  await expect(exportButton).toHaveAttribute("aria-expanded", "false");
  await page.locator("#import-file").setInputFiles(puzzleDownloadPath);
  await page.getByRole("button", { name: "Puzzle properties" }).click();
  await expect(propertiesDialog.getByRole("textbox", { name: "PUZZLE NAME" })).toHaveValue(
    "Authored Puzzle",
  );
  await expect(propertiesDialog.getByRole("textbox", { name: "ID" })).toHaveValue(
    "authored-puzzle",
  );
  await expect(propertiesDialog.getByRole("combobox", { name: "GROUP" })).toHaveValue("runelore");
  await expect(propertiesDialog.getByRole("spinbutton", { name: "ORDER" })).toHaveValue("12.5");
  await expect(propertiesDialog.getByRole("textbox", { name: "GOAL" })).toHaveValue(
    "Deliver the authored mechanism.",
  );
  await expect(propertiesDialog.getByRole("spinbutton", { name: "CYCLE LIMIT" })).toHaveValue(
    "321",
  );
  await expect(propertiesDialog.getByRole("spinbutton", { name: "WIDTH" })).toHaveValue("22");
  await expect(propertiesDialog.getByRole("spinbutton", { name: "HEIGHT" })).toHaveValue("15");
  await propertiesDialog.getByRole("button", { name: "CANCEL" }).click();


  await page.goto("/puzzles/first-shift");
  await page.getByRole("button", { name: "+ NEW SOLUTION" }).click();
  await exportButton.click();
  await expect(page.getByRole("button", { name: "Editable region tool" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "DOWNLOAD SCENE FILE" })).toBeVisible();
  await expect(page.getByRole("button", { name: "DOWNLOAD PUZZLE FILE" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "SHARE PUZZLE" })).toHaveCount(0);
});

test("puzzle info remains horizontally contained and vertically reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await seedBrowserStorage(page, "populated");
  await page.goto("/puzzles/first-shift");

  const overflow = await page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>("#puzzle-info-screen");
    const deleteButton = document.querySelector<HTMLElement>(
      ".solution-row-actions .solution-delete-action",
    );
    if (screen === null || deleteButton === null) {
      throw new Error("Puzzle info layout is incomplete");
    }
    screen.scrollTop = screen.scrollHeight;
    const screenBounds = screen.getBoundingClientRect();
    const deleteBounds = deleteButton.getBoundingClientRect();
    return {
      horizontal: screen.scrollWidth - screen.clientWidth,
      canScroll: screen.scrollTop > 0,
      deleteButtonBelowViewport: deleteBounds.bottom - screenBounds.bottom,
    };
  });
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  expect(overflow.canScroll).toBe(true);
  expect(overflow.deleteButtonBelowViewport).toBeLessThanOrEqual(1);
});
