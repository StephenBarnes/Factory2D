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
    const sidebar = document.querySelector<HTMLElement>("#sidebar-controls");
    const controls = document.querySelector<HTMLElement>("#bottom-controls");
    const inspector = document.querySelector<HTMLElement>("#tile-inspector");
    if (canvas === null || sidebar === null || controls === null || inspector === null) {
      throw new Error("Workshop layout is incomplete");
    }

    const canvasBounds = canvas.getBoundingClientRect();
    const sidebarBounds = sidebar.getBoundingClientRect();
    const controlsBounds = controls.getBoundingClientRect();
    const inspectorBounds = inspector.getBoundingClientRect();
    const left = Math.max(16, sidebarBounds.right - canvasBounds.left + 16);
    const right = Math.max(16, canvasBounds.right - inspectorBounds.left + 16);
    const top = 16;
    const bottom = Math.max(16, canvasBounds.bottom - controlsBounds.top + 16);
    const safeWidth = Math.max(1, canvas.clientWidth - left - right);
    const safeHeight = Math.max(1, canvas.clientHeight - top - bottom);
    const cellSize = Math.max(2, Math.min(safeWidth / 20, safeHeight / 14, 64));
    const originX = left + safeWidth / 2 - 10 * cellSize;
    const originY = top + safeHeight / 2 - 7 * cellSize;
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

test("unlocked fixture opens the dependent puzzle", async ({ page }) => {
  await seedBrowserStorage(page, "unlocked");
  await page.goto("/");
  const beltworks = page.getByRole("button", { name: /^02 Beltworks/ });
  await expect(beltworks).toBeEnabled();
  await beltworks.click();
  await expect(page).toHaveURL(/\/puzzles\/beltworks$/);
});

test("creates, edits, persists, and restores a solution on reload", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/puzzles/first-shift");
  await page.getByRole("button", { name: "+ NEW SOLUTION" }).click();
  await expect(page).toHaveURL(/\/puzzles\/first-shift\/solutions\/solution-1$/);

  const initial = await diagnosticSnapshot(page);
  expect(initial.activeSolutionId).toBe("solution-1");
  await placeStone(page, 8, 2);
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
  await expect(report.locator(".test-report-result")).toHaveCount(2);
  await expect(report.getByText("CYCLE LIMIT", { exact: true })).toHaveCount(2);

  await report.getByRole("button", { name: "CONTINUE EDITING" }).click();
  await expect(report).not.toBeVisible();
  await testButton.click();
  await report.getByRole("button", { name: "BACK TO PUZZLE" }).click();
  await expect(page).toHaveURL(/\/puzzles\/first-shift$/);

  await page.goto("/sandbox");
  await expect(page.getByRole("button", { name: "▶ RUN" })).toBeVisible();
  await expect(report).not.toBeVisible();
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

  const exportButton = page.getByRole("button", { name: "EXPORT" });
  await exportButton.click();
  await expect(exportButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "DOWNLOAD SCENE FILE" })).toBeVisible();
  await expect(page.getByRole("button", { name: "COPY SCENE TO CLIPBOARD" })).toBeVisible();
  await expect(page.getByRole("button", { name: "DOWNLOAD IMAGE" })).toBeVisible();
  await expect(page.getByRole("button", { name: "DOWNLOAD PUZZLE FILE" })).toBeVisible();
  await expect(page.getByRole("button", { name: "SHARE PUZZLE" })).toBeDisabled();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD SCENE FILE" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("factory2d-scene.json");
  await expect(exportButton).toHaveAttribute("aria-expanded", "false");

  await page.goto("/puzzles/first-shift");
  await page.getByRole("button", { name: "+ NEW SOLUTION" }).click();
  await exportButton.click();
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
