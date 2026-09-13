import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { DevelopmentDiagnosticSnapshot } from "../src/dev/diagnostic-snapshot";
import {
  PLAYER_DATA_FORMAT,
  PLAYER_DATA_VERSION,
} from "../src/game/player-data";
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

async function openNewSandbox(page: Page): Promise<void> {
  await page.goto("/sandbox");
  await expect(page.getByRole("heading", { name: "Sandbox", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "+ NEW SANDBOX" }).click();
  await expect(page).toHaveURL(/\/sandbox\/sandbox-\d+$/);
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

test("placement drags weld only their path, including fast diagonals", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await openNewSandbox(page);
  await page.getByRole("button", { name: /^Stone/ }).click();
  const drag = async (cells: readonly (readonly [number, number])[]) => {
    for (const [index, [x, y]] of cells.entries()) {
      const point = await boardCellCenter(page, x, y);
      await page.mouse.move(point.x, point.y);
      if (index === 0) await page.mouse.down();
    }
    await page.mouse.up();
  };
  await drag([[1, 1], [4, 1], [4, 2], [1, 2]]);
  let board = JSON.parse((await diagnosticSnapshot(page)).serializedBoard);
  expect(board.welds[1].slice(1, 5)).toBe("---|");
  expect(board.welds[2].slice(1, 5)).toBe("---.");

  await drag([[6, 1], [8, 3]]);
  board = JSON.parse((await diagnosticSnapshot(page)).serializedBoard);
  expect(board.grid[1].slice(6, 9)).toBe("##.");
  expect(board.grid[2].slice(6, 9)).toBe(".##");
  expect(board.grid[3][8]).toBe("#");
  expect(board.welds[1].slice(6, 9)).toBe("-|.");
  expect(board.welds[2].slice(6, 9)).toBe(".-|");

  await page.keyboard.down("Shift");
  await drag([[2, 1]]);
  await page.keyboard.up("Shift");
  board = JSON.parse((await diagnosticSnapshot(page)).serializedBoard);
  expect(board.welds[1][2]).toBe("+");

  await page.getByRole("button", { name: /^Sand / }).click();
  await drag([[10, 1], [12, 1]]);
  board = JSON.parse((await diagnosticSnapshot(page)).serializedBoard);
  expect(board.welds[1].slice(10, 13)).toBe("...");
  await page.reload();
  board = JSON.parse((await diagnosticSnapshot(page)).serializedBoard);
  expect(board.welds[1].slice(1, 5)).toBe("-+-|");
});

for (const entering of [false, true]) {
  test(`placement drag welds ${entering ? "into" : "out of"} the puzzle region without replacing fixed tiles`, async ({ page }) => {
    await seedBrowserStorage(page, "unlocked");
    await page.goto("/puzzles/sand-fall");
    await page.getByRole("button", { name: "+ NEW SOLUTION" }).click();
    await page.getByRole("button", { name: /^Stone/ }).click();
    const before = JSON.parse((await diagnosticSnapshot(page)).serializedBoard);
    const inside = await boardCellCenter(page, 4, 5);
    const outside = await boardCellCenter(page, 4, 6);
    const [start, end] = entering ? [outside, inside] : [inside, outside];
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
    await page.mouse.up();
    const board = JSON.parse((await diagnosticSnapshot(page)).serializedBoard);
    expect(board.grid[5][4]).toBe("#");
    expect(board.welds[5][4]).toBe("|");
    expect(board.grid[6]).toBe(before.grid[6]);
    expect(board.welds[6]).toBe(before.welds[6]);
    await page.reload();
    expect(JSON.parse((await diagnosticSnapshot(page)).serializedBoard)).toEqual(board);
  });
}

test("creates, persists, duplicates, and deletes saved sandboxes", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/");
  await page.getByRole("button", { name: /Sandbox/ }).click();
  await expect(page).toHaveURL(/\/sandbox$/);
  await expect(page.getByText("No saved sandboxes. Create one to enter the workshop.")).toBeVisible();

  await page.getByRole("button", { name: "+ NEW SANDBOX" }).click();
  await expect(page).toHaveURL(/\/sandbox\/sandbox-1$/);
  await expect(page.locator("#screen-title")).toHaveText("SANDBOX 1");
  await placeStone(page, 0, 0);
  await page.getByRole("button", { name: "← SANDBOX" }).click();
  await expect(page.getByText("Sandbox 1", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Edit Sandbox 1" }).click();
  const board = JSON.parse((await diagnosticSnapshot(page)).serializedBoard) as {
    readonly grid: readonly string[];
  };
  expect(board.grid[0]?.[0]).toBe("#");
  await page.getByRole("button", { name: "← SANDBOX" }).click();

  await page.getByRole("button", { name: "Duplicate Sandbox 1" }).click();
  await expect(page.getByText("Sandbox 1 Copy", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Sandbox 1 Copy" }).click();
  await expect(page.getByText("Sandbox 1 Copy", { exact: true })).toHaveCount(0);
});

test("selection shortcuts use occupied bounds and grid clicks unselect", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await openNewSandbox(page);
  await page.getByRole("button", { name: "Selection tool" }).click();

  await page.keyboard.press("Control+A");
  const selectionActions = page.locator("#selection-actions");
  await expect(selectionActions).toBeVisible();
  await expect(page.getByRole("button", { name: "Flip vertically" })).toBeVisible();

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

test("opens settings and about from the main menu", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await page.goto("/");

  await page.getByRole("button", { name: "SETTINGS" }).click();
  const settings = page.getByRole("dialog", { name: "SETTINGS" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("button", { name: "DOWNLOAD PLAYER DATA" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "IMPORT PLAYER DATA" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "CLEAR ALL PLAYER DATA" })).toBeVisible();
  await settings.getByRole("button", { name: "CLOSE" }).click();

  await page.getByRole("button", { name: "ABOUT", exact: true }).click();
  const about = page.getByRole("dialog", { name: "Factory 2D", exact: true });
  await expect(about).toBeVisible();
  await expect(about.getByRole("link", { name: "VIEW SOURCE ON GITHUB" })).toHaveAttribute(
    "href",
    "https://github.com/StephenBarnes/Factory2D",
  );
  await about.getByRole("button", { name: "CLOSE" }).click();
  await expect(about).toBeHidden();
  await expect(page.getByRole("button", { name: "ABOUT", exact: true })).toBeFocused();
});

test("exports, clears, and imports all player data", async ({ page }) => {
  const fixture = await seedBrowserStorage(page, "unlocked");
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem("factory2d.test-setting", "custom value");
  });

  await page.getByRole("button", { name: "SETTINGS" }).click();
  const settings = page.getByRole("dialog", { name: "SETTINGS" });
  const downloadPromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "DOWNLOAD PLAYER DATA" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("factory2d-player-data.json");
  const downloadPath = await download.path();
  if (downloadPath === null) {
    throw new Error("Player data download did not produce a local file");
  }
  const exported = JSON.parse(await readFile(downloadPath, "utf8")) as {
    readonly format: string;
    readonly version: number;
    readonly entries: readonly { readonly key: string; readonly value: string }[];
  };
  expect(exported).toEqual({
    format: PLAYER_DATA_FORMAT,
    version: PLAYER_DATA_VERSION,
    entries: Object.entries({
      ...fixture.values,
      "factory2d.test-setting": "custom value",
    }).sort(([first], [second]) => first.localeCompare(second))
      .map(([key, value]) => ({ key, value })),
  });

  const clearReload = page.waitForEvent("load");
  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await settings.getByRole("button", { name: "CLEAR ALL PLAYER DATA" }).click();
  await clearReload;
  await expect(page.locator(".gemstone-count")).toHaveAccessibleName(/^0 gemstones\b/);
  expect(await page.evaluate(() => window.localStorage.length)).toBe(0);

  await page.getByRole("button", { name: "SETTINGS" }).click();
  const importReload = page.waitForEvent("load");
  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.locator("#import-player-data-file").setInputFiles(downloadPath);
  await importReload;

  await expect(page.locator(".gemstone-count")).toHaveAccessibleName(/^2 gemstones\b/);
  expect(await page.evaluate(() => Object.fromEntries(
    Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index);
      if (key === null) {
        throw new Error(`Missing localStorage key ${index}`);
      }
      const value = window.localStorage.getItem(key);
      if (value === null) {
        throw new Error(`Missing localStorage value for ${key}`);
      }
      return [key, value];
    }),
  ))).toEqual({
    ...fixture.values,
    "factory2d.test-setting": "custom value",
  });
});

test("edge panels reserve a non-overlapping canvas region", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await openNewSandbox(page);

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 640 },
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
        sidebarLeft: sidebarBounds.left,
        sidebarTop: sidebarBounds.top,
        sidebarBottomGap: controlsBounds.top - sidebarBounds.bottom,
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
    const header = page.locator(".workshop-header");
    const beforeScroll = await header.boundingBox();
    await page.locator(".sidebar-content").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await header.boundingBox()).toEqual(beforeScroll);
    await expect(header.locator("#menu-button")).toBeInViewport();
    await expect(header.locator("#workshop-info-button")).toBeInViewport();
    await expect(page.locator("#reset-button")).toBeInViewport();
  }
});

test("workshop identity exposes information and live puzzle metrics", async ({ page }) => {
  await seedBrowserStorage(page, "populated");
  await page.goto("/puzzles/first-shift/solutions/solution-1");

  const controls = page.locator("#bottom-controls");
  const identity = controls.locator(".workshop-identity");
  const header = page.locator(".workshop-header");
  const footprint = identity.locator("#puzzle-footprint");
  const price = identity.locator("#puzzle-price");
  const palette = page.locator("#component-palette");
  await expect(header.locator("#screen-title")).toHaveText("FIRST SHIFT");
  await expect(price).toHaveText("0⚙");
  await expect(footprint).toHaveText("0×0");
  await expect(page.locator("#screen-description")).toHaveCount(0);

  await header.getByRole("button", { name: "Puzzle information" }).click();
  const dialog = page.locator("#workshop-info-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "First Shift" })).toBeVisible();
  await dialog.getByRole("button", { name: "CLOSE" }).click();

  await price.hover();
  await expect(palette).toHaveClass(/show-prices/);
  const stoneButton = page.getByRole("button", { name: /^Stone/ });
  await expect.poll(async () =>
    stoneButton.evaluate((element) => getComputedStyle(element, "::after").content)
  ).toContain("1⚙");

  await placeStone(page, 8, 3);
  await expect(price).toHaveText("1⚙");
  await expect(footprint).toHaveText("1×1");
  await expect(palette).not.toHaveClass(/show-prices/);

  await openNewSandbox(page);
  await expect(page.locator("#puzzle-metrics")).toBeHidden();
  await expect(page.locator("#screen-title")).toHaveText("SANDBOX 1");
  await page.getByRole("button", { name: "Puzzle properties" }).click();
  await expect(dialog).toBeVisible();
  const materials = dialog.locator(".workshop-properties-component-group").filter({
    has: page.getByRole("checkbox", { name: "Stone", exact: true }),
  });
  await dialog.getByRole("checkbox", { name: "Conveyor Belt", exact: true }).check();
  await materials.getByRole("button", { name: /^Enable all / }).click();
  await expect(dialog.getByRole("checkbox", { name: "Sand", exact: true })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Stone", exact: true })).toBeChecked();
  await materials.getByRole("button", { name: /^Disable all / }).click();
  await expect(dialog.getByRole("checkbox", { name: "Sand", exact: true })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Stone", exact: true })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Conveyor Belt", exact: true })).toBeChecked();
  await materials.getByRole("button", { name: /^Enable all / }).click();
  await expect(dialog.getByRole("checkbox", { name: "Sand", exact: true })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Stone", exact: true })).toBeChecked();
  await expect(dialog.locator("[data-workshop-info-goal-panel]")).toBeHidden();
});

test("sandbox test-case menu duplicates, switches, and deletes independent boards", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await openNewSandbox(page);

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
  await openNewSandbox(page);

  const inspector = page.locator("#tile-inspector");
  const inspectorName = inspector.locator("[data-inspector-name]");
  const inspectorPosition = inspector.locator("[data-inspector-position]");
  const sandButton = page.getByRole("button", { name: /^Sand/ });
  await sandButton.hover();
  await expect(inspectorName).toHaveText("SAND");
  await expect(inspectorPosition).toBeHidden();
  await expect(inspector.locator("[data-inspector-price]")).toBeHidden();

  await placeStone(page, 10, 8);
  await sandButton.click();
  const occupiedCell = await boardCellCenter(page, 10, 8);
  await page.mouse.move(occupiedCell.x, occupiedCell.y);
  await expect(inspectorName).toHaveText("STONE");
  await expect(inspectorPosition).toHaveText(/X 10\s+Y 08\s+ID #\d{4}/);
  await expect(inspector.locator("[data-inspector-price]")).toBeHidden();

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

  const editableRegionTool = page.getByRole("button", { name: "Editable region tool" });
  await editableRegionTool.hover();
  await expect(inspectorName).toHaveText("EDITABLE REGION TOOL");

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
  const basics = page.locator(".puzzle-group").filter({
    has: page.getByText("Basics", { exact: true }),
  });
  const runelore = page.locator(".puzzle-group").filter({
    has: page.getByText("Runelore", { exact: true }),
  });
  await expect(gemstoneCount).toHaveAccessibleName(/^0 gemstones\b/);
  await expect(basics).toHaveJSProperty("open", true);
  await expect(runelore).toHaveJSProperty("open", false);
  await runelore.locator("summary").click();
  await expect(runelore).toHaveJSProperty("open", true);
  await expect(page.getByRole("button", { name: /First Shift/ })).toBeEnabled();
  const runeloreButtons = runelore.locator("button");
  await expect(runeloreButtons).not.toHaveCount(0);
  for (const button of await runeloreButtons.all()) {
    await expect(button).toBeDisabled();
  }
});

test("unlocked fixture opens a gemstone-gated group and puzzle", async ({ page }) => {
  await seedBrowserStorage(page, "unlocked");
  await page.goto("/");

  const basics = page.locator(".puzzle-group").filter({
    has: page.getByText("Basics", { exact: true }),
  });
  const runelore = page.locator(".puzzle-group").filter({
    has: page.getByText("Runelore", { exact: true }),
  });
  await expect(page.locator(".gemstone-count")).toHaveAccessibleName(/^2 gemstones\b/);
  await expect(basics).toHaveJSProperty("open", false);
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

test("sandbox painting and erasure continue across simulation ticks", async ({ page }) => {
  await seedBrowserStorage(page, "empty");
  await openNewSandbox(page);
  await page.getByRole("button", { name: /^Platform/ }).click();
  await page.keyboard.press("Space");

  for (const button of ["left", "right"] as const) {
    const start = await boardCellCenter(page, 1, 3);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button });
    for (let x = 2; x <= 4; x++) {
      const tick = (await diagnosticSnapshot(page)).simulation.tick;
      await expect.poll(async () => (await diagnosticSnapshot(page)).simulation.tick)
        .toBeGreaterThan(tick);
      const point = await boardCellCenter(page, x, 3);
      await page.mouse.move(point.x, point.y);
    }
    await page.mouse.up({ button });
    const board = JSON.parse((await diagnosticSnapshot(page)).serializedBoard);
    expect(board.grid[3].slice(1, 5)).toBe(button === "left" ? "====" : "....");
  }

  await page.keyboard.press("Space");
  await page.reload();
  const board = JSON.parse((await diagnosticSnapshot(page)).serializedBoard);
  expect(board.grid[3].slice(1, 5)).toBe("....");
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

  const testButton = page.getByRole("button", { name: "▶ TEST" });
  const fastForwardButton = page.getByRole("button", { name: /FAST/ });
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
  await expect(fastForwardButton).toBeVisible();

  await page.getByRole("button", { name: "RESET" }).click();
  await expect(page.getByRole("status")).not.toBeVisible();
  await expect(page.locator("#tick-counter")).toHaveText("TICK 0000");
  await expect(page.locator("#state-label")).toHaveText("BUILD MODE");

  await fastForwardButton.click();
  await expect(page.locator("#tick-counter")).toHaveText("TICK 0010");
  await page.keyboard.press("r");
  await expect(page.locator("#tick-counter")).toHaveText("TICK 0000");
  await page.keyboard.press("n");
  await expect(page.locator("#tick-counter")).toHaveText("TICK 0001");
  await page.keyboard.press("r");
  await page.keyboard.press("f");
  await expect(page.locator("#state-label")).toHaveText("TEST FAILED");
  await expect(page.locator("#tick-counter")).toHaveText("TICK 0010");

  await page.locator("#menu-button").click();
  await expect(page).toHaveURL(/\/puzzles\/first-shift$/);

  await openNewSandbox(page);
  await expect(page.getByRole("button", { name: "▶ RUN" })).toBeVisible();
  await expect(fastForwardButton).not.toBeVisible();
  await expect(report).not.toBeVisible();
});

test("persists successful solution scores on the puzzle briefing", async ({ page }) => {
  await seedBrowserStorage(page, "populated");
  await page.goto("/puzzles/first-shift/solutions/solution-1");
  await placeStone(page, 9, 3);
  await page.getByRole("button", { name: "▶ TEST" }).click();
  await page.getByRole("button", { name: /FAST/ }).click();

  const report = page.getByRole("dialog");
  await expect(report.getByRole("heading", { name: "ALL TESTS PASSED" })).toBeVisible();
  await expect(report.locator("[data-test-report-price]")).toHaveText("1");
  await expect(report.locator("[data-test-report-cycles]")).toHaveText("9");
  await expect(report.locator("[data-test-report-footprint]")).toHaveText("1");
  await expect(report.locator("[data-test-report-combined]")).toHaveText("11");

  await report.getByRole("button", { name: "BACK TO BRIEFING" }).click();
  const scoredSolution = page.locator("#solution-list").getByRole("listitem").filter({
    has: page.locator(".solution-identity strong", { hasText: "Solution 1" }),
  });
  await expect(scoredSolution).toBeVisible();
  await expect(scoredSolution.locator(".solution-scores strong")).toHaveText(["1", "9", "1", "11"]);
  await expect(scoredSolution).toHaveClass(/best-score/);
  await page.reload();
  await expect(scoredSolution).toBeVisible();
  await expect(scoredSolution).toHaveClass(/best-score/);
});

test("highlights every confirmed solution tied for the lowest combined score", async ({ page }) => {
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

  await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === null) {
      throw new Error("Saved-solution storage is missing");
    }
    const stored = JSON.parse(serialized) as {
      solutions: Array<{ id: string; scores: unknown }>;
    };
    const first = stored.solutions.find(({ id }) => id === "solution-1");
    const second = stored.solutions.find(({ id }) => id === "solution-2");
    if (first === undefined || second === undefined) {
      throw new Error("Scored-solution fixture is incomplete");
    }
    first.scores = second.scores;
    window.localStorage.setItem(storageKey, JSON.stringify(stored));
  }, PUZZLE_SOLUTIONS_STORAGE_KEY);
  await page.reload();
  await expect(rows.filter({ hasText: "Solution 1" })).toHaveClass(/best-score/);
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
  await openNewSandbox(page);
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
  await propertiesDialog.getByRole("checkbox", { name: "Sand", exact: true }).uncheck();
  await propertiesDialog.getByRole("checkbox", { name: "Stone", exact: true }).check();
  await propertiesDialog.getByRole("spinbutton", { name: "Stone price", exact: true }).fill("9");
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
  await expect(page.getByRole("button", { name: "DOWNLOAD PUZZLE FILE" })).toBeVisible();
  await expect(page.getByRole("button", { name: "SHARE PUZZLE" })).toHaveCount(0);
  const originalDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD PUZZLE FILE" }).click();
  const originalDownload = await originalDownloadPromise;
  expect(originalDownload.suggestedFilename()).toBe("first-shift.json");
  const originalPath = await originalDownload.path();
  if (originalPath === null) {
    throw new Error("Original puzzle download is missing");
  }
  const shippedPuzzle = JSON.parse(await readFile("src/game/puzzles/first-shift.json", "utf8"));
  expect(JSON.parse(await readFile(originalPath, "utf8"))).toEqual(shippedPuzzle);

  await exportButton.click();
  await page.getByRole("button", { name: "OPEN PUZZLE IN SANDBOX" }).click();
  await expect(page).toHaveURL(/\/sandbox\/sandbox-\d+$/);
  await page.reload();
  await page.getByRole("button", { name: "Puzzle properties" }).click();
  await expect(propertiesDialog.getByRole("textbox", { name: "ID" })).toHaveValue("first-shift");
  await propertiesDialog.getByRole("button", { name: "CANCEL" }).click();
  await exportButton.click();
  await expect(page.getByRole("button", { name: "OPEN PUZZLE IN SANDBOX" })).toHaveCount(0);
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
