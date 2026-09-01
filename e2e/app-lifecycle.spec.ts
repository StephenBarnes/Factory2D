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

test("edge panels reserve a non-overlapping canvas region", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/sandbox");

  for (const viewport of [
    { width: 1280, height: 800, compact: false },
    { width: 390, height: 640, compact: true },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
      const sidebar = document.querySelector<HTMLElement>("#sidebar-controls");
      const controls = document.querySelector<HTMLElement>("#bottom-controls");
      if (canvas === null || sidebar === null || controls === null) {
        throw new Error("Workshop layout is incomplete");
      }

      const canvasBounds = canvas.getBoundingClientRect();
      const sidebarBounds = sidebar.getBoundingClientRect();
      const controlsBounds = controls.getBoundingClientRect();
      return {
        canvasWidth: canvasBounds.width,
        canvasHeight: canvasBounds.height,
        canvasLeftGap: canvasBounds.left - sidebarBounds.right,
        canvasBottomGap: controlsBounds.top - canvasBounds.bottom,
        canvasTop: canvasBounds.top,
        canvasRightGap: window.innerWidth - canvasBounds.right,
        controlsBottomGap: window.innerHeight - controlsBounds.bottom,
        controlsLeft: controlsBounds.left,
        controlsLeftGap: controlsBounds.left - sidebarBounds.right,
        sidebarLeft: sidebarBounds.left,
        sidebarTop: sidebarBounds.top,
        sidebarBottomGap: window.innerHeight - sidebarBounds.bottom,
        compactSidebarBottomGap: controlsBounds.top - sidebarBounds.bottom,
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
    if (viewport.compact) {
      expect(Math.abs(layout.controlsLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(layout.compactSidebarBottomGap)).toBeLessThanOrEqual(1);
    } else {
      expect(Math.abs(layout.controlsLeftGap)).toBeLessThanOrEqual(1);
      expect(Math.abs(layout.sidebarBottomGap)).toBeLessThanOrEqual(1);
    }
  }
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
  await expect(inspectorPosition).toHaveText("PALETTE COMPONENT");
  await expect(inspector).toContainText("Falls downward and can fall diagonally around obstacles");

  await placeStone(page, 10, 8);
  await sandButton.click();
  const occupiedCell = await boardCellCenter(page, 10, 8);
  await page.mouse.move(occupiedCell.x, occupiedCell.y);
  await expect(inspectorName).toHaveText("STONE");
  await expect(inspectorPosition).toHaveText(/X 10\s+Y 08\s+ID #\d{4}/);
  await expect(inspectorHint).toHaveText("Solid block affected by gravity");
  for (const removedLabel of ["TILE ID", "MOVEMENT", "WELDABLE", "WELDS", "MAGNETIC"]) {
    await expect(inspector.getByText(removedLabel, { exact: true })).toHaveCount(0);
  }

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

test("unlocked fixture opens the dependent puzzle", async ({ page }) => {
  await seedBrowserStorage(page, "unlocked");
  await page.goto("/");
  const conduits = page.getByRole("button", { name: /^03 Conduits/ });
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
test("tests puzzle cases in a report while sandbox keeps run controls", async ({ page }) => {
  await seedBrowserStorage(page, "populated");
  await page.goto("/puzzles/first-shift/solutions/solution-1");

  const testButton = page.getByRole("button", { name: "◆ TEST" });
  await expect(testButton).toBeVisible();
  await expect(page.getByRole("button", { name: /RUN/ })).toHaveCount(0);
  await testButton.click();

  const report = page.getByRole("dialog");
  await expect(report).toBeVisible();
  await expect(report.getByRole("heading", { name: "TESTS FAILED" })).toBeVisible();
  await expect(report.locator(".test-report-result")).toHaveCount(1);
  await expect(report.getByText("CYCLE LIMIT", { exact: true })).toHaveCount(1);

  await report.getByRole("button", { name: "CONTINUE EDITING" }).click();
  await expect(report).not.toBeVisible();
  await testButton.click();
  await report.getByRole("button", { name: "BACK TO PUZZLE" }).click();
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

  const report = page.getByRole("dialog");
  await expect(report.getByRole("heading", { name: "ALL TESTS PASSED" })).toBeVisible();
  await expect(report.locator("[data-test-report-price]")).toHaveText("1");
  await expect(report.locator("[data-test-report-cycles]")).toHaveText("9");
  await expect(report.locator("[data-test-report-footprint]")).toHaveText("1");
  await expect(report.locator("[data-test-report-combined]")).toHaveText("11");

  await report.getByRole("button", { name: "BACK TO PUZZLE" }).click();
  const scoredSolution = page.getByRole("option", {
    name: "Solution 1 Confirmed successful PRICE 1 CYCLES 9 FOOTPRINT 1 COMBINED 11",
  });
  await expect(scoredSolution).toBeVisible();
  await page.reload();
  await expect(scoredSolution).toBeVisible();
});


test("duplicates an edited board into an independent restorable solution", async ({ page }) => {
  const fixture = await seedBrowserStorage(page, "edited-board");
  await page.goto("/puzzles/first-shift");
  await page.getByRole("button", { name: "DUPLICATE" }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option", { name: /Solution 1 Copy/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("button", { name: "EDIT SELECTED" }).click();
  const duplicate = await diagnosticSnapshot(page);
  expect(duplicate.activeSolutionId).toBe("solution-2");
  expect(duplicate.serializedBoard).toBe(fixture.editedBoard);

  await page.reload();
  expect((await diagnosticSnapshot(page)).serializedBoard).toBe(fixture.editedBoard);
});

test("deletes the selected solution and keeps it deleted after reload", async ({ page }) => {
  await seedBrowserStorage(page, "populated");
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/puzzles/first-shift");
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("button", { name: "DELETE" }).click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option", { name: /Solution 2/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option", { name: /Solution 1$/ })).toHaveCount(0);
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
  expect(puzzleDownload.suggestedFilename()).toBe("factory2d-puzzle.json");
  const puzzleDownloadPath = await puzzleDownload.path();
  if (puzzleDownloadPath === null) {
    throw new Error("Puzzle download did not produce a local file");
  }
  const puzzleFile = JSON.parse(await readFile(puzzleDownloadPath, "utf8")) as {
    readonly editableRegions: readonly unknown[];
  };
  expect(puzzleFile.editableRegions).toEqual([{ x: 10, y: 1, width: 2, height: 2 }]);

  await exportButton.click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD SCENE FILE" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("factory2d-scene.json");
  await expect(exportButton).toHaveAttribute("aria-expanded", "false");

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
    const deleteButton = document.querySelector<HTMLElement>("#delete-solution-button");
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
