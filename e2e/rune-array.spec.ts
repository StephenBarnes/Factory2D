import { expect, test, type Page } from "@playwright/test";
import type { DevelopmentDiagnosticSnapshot } from "../src/dev/diagnostic-snapshot";

interface NestedBoardJson {
  readonly grid: readonly string[];
  readonly components: readonly {
    readonly type: string;
    readonly description?: string;
    readonly board?: NestedBoardJson;
  }[];
}

async function diagnosticSnapshot(page: Page): Promise<DevelopmentDiagnosticSnapshot> {
  await expect.poll(() => page.evaluate(() => typeof window.factory2dDiagnostics)).toBe("object");
  return page.evaluate(() => {
    const diagnostics = window.factory2dDiagnostics;
    if (diagnostics === undefined) {
      throw new Error("Development diagnostics are not installed");
    }
    return diagnostics.snapshot();
  });
}

/** Screen center of a cell on the displayed board, which is fitted with a one-cell margin when nested. */
async function viewCellCenter(
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
    const view = diagnostics.snapshot().view;
    const margin = view.depth === 0 ? 0 : 1;
    const cellSize = Math.min(
      canvas.clientWidth / (view.width + margin * 2),
      canvas.clientHeight / (view.height + margin * 2),
      64,
    );
    const originX = (canvas.clientWidth - view.width * cellSize) / 2;
    const originY = (canvas.clientHeight - view.height * cellSize) / 2;
    return {
      x: canvasBounds.left + originX + (cellX + 0.5) * cellSize,
      y: canvasBounds.top + originY + (cellY + 0.5) * cellSize,
    };
  }, { cellX: x, cellY: y });
}

async function hoverViewCell(page: Page, x: number, y: number): Promise<void> {
  const center = await viewCellCenter(page, x, y);
  await page.mouse.move(center.x, center.y);
  await expect.poll(async () => (await diagnosticSnapshot(page)).hoveredCell).toEqual({ x, y });
}

async function rootBoard(page: Page): Promise<NestedBoardJson> {
  return JSON.parse((await diagnosticSnapshot(page)).serializedBoard) as NestedBoardJson;
}

test("rune arrays open as nested boards that share the workshop tools", async ({ page }) => {
  await page.goto("/sandbox");
  const bar = page.locator("#nested-view-bar");
  await expect(bar).toBeHidden();

  await page.locator('[data-tile="36"]').click();
  await hoverViewCell(page, 4, 4);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await rootBoard(page)).grid[4]?.[4]).toBe("A");

  await hoverViewCell(page, 4, 4);
  await page.keyboard.press("Enter");
  await expect(bar).toBeVisible();
  await expect(page.locator("#nested-view-trail")).toContainText("RUNE ARRAY");
  await expect.poll(async () => (await diagnosticSnapshot(page)).view).toEqual({
    depth: 1,
    width: 5,
    height: 5,
    editable: true,
  });

  await page.locator('[data-tile="6"]').click();
  await hoverViewCell(page, 2, 4);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => {
    const array = (await rootBoard(page)).components[0];
    return array?.board?.grid[4]?.[2];
  }).toBe("C");

  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
  expect((await diagnosticSnapshot(page)).view.depth).toBe(0);

  await hoverViewCell(page, 4, 4);
  await page.keyboard.press("KeyE");
  const dialog = page.locator("#component-configuration-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("[data-component-array-width]").fill("7");
  await dialog.locator("[data-component-array-height]").fill("7");
  await dialog.locator("[data-component-array-description]").fill("Pass-through");
  await dialog.locator("[data-component-array-open]").click();
  await expect(dialog).toBeHidden();
  await expect(bar).toBeVisible();
  await expect(page.locator("#nested-view-trail")).toContainText("7×7");
  await expect(page.locator("#nested-view-trail")).toContainText("Pass-through");
  await expect.poll(async () => (await diagnosticSnapshot(page)).view).toMatchObject({
    depth: 1,
    width: 7,
    height: 7,
  });
  const array = (await rootBoard(page)).components[0];
  expect(array?.description).toBe("Pass-through");
  expect(array?.board?.grid).toEqual([
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    "...C...",
    ".......",
  ]);

  await page.locator("#nested-view-back-button").click();
  await expect(bar).toBeHidden();
});
