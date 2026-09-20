import { expect, test } from "@playwright/test";
import type { CanvasRenderer as CanvasRendererClass } from "../src/render/canvas-renderer";
import type { World as WorldClass } from "../src/simulation/world";

test("auto-sized annotations paint every line inside their boxes", async ({ page }) => {
  await page.goto("/#/");
  const result = await page.evaluate(async () => {
    // Browser evaluation cannot capture Node imports; load Vite's browser modules in this realm.
    const rendererPath = "/src/render/canvas-renderer.ts";
    const worldPath = "/src/simulation/world.ts";
    const { CanvasRenderer } = await import(rendererPath) as { CanvasRenderer: typeof CanvasRendererClass };
    const { World } = await import(worldPath) as { World: typeof WorldClass };
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;width:512px;height:384px;z-index:10000";
    document.body.append(canvas);
    const world = new World(8, 6);
    const renderer = new CanvasRenderer(canvas, world);
    renderer.fitBoardToViewport();
    const base = { id: "single", centerX: 3, centerY: 2, text: "Abc", owner: "author" as const };
    const single = renderer.fitTextBox(base);
    const four = renderer.fitTextBox({ ...base, id: "four", centerX: 5, text: "Abc\n123\nXyz\n456" });
    const wide = renderer.fitTextBox({ ...base, text: "A longer line of annotation text" });
    const wrapped = renderer.fitTextBox({ ...base, centerX: 8, centerY: 6, text: "Words that must fit within the board. ".repeat(20) });
    if (single === null || four === null || wide === null || wrapped === null) {
      throw new Error("Short annotations must fit the board");
    }
    world.setTextBoxes([single, four]);
    renderer.render();
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas context is missing");
    const scale = canvas.width / world.width;
    const paintedRows = (box: typeof single) => {
      const bounds = renderer.textBoxBounds(box);
      const left = Math.ceil(bounds.x * scale);
      const top = Math.ceil(bounds.y * scale);
      const width = Math.floor(bounds.width * scale);
      const height = Math.floor(bounds.height * scale);
      const pixels = context.getImageData(left, top, width, height).data;
      const rows: number[] = [];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const offset = (y * width + x) * 4;
          // Text is pale cream; the darker frame and board cannot satisfy this threshold.
          if (pixels[offset]! > 210 && pixels[offset + 1]! > 190 && pixels[offset + 2]! > 160) {
            rows.push(y / scale);
            break;
          }
        }
      }
      return rows;
    };
    return {
      single: renderer.textBoxBounds(single),
      four: renderer.textBoxBounds(four),
      wide: renderer.textBoxBounds(wide),
      wrapped: renderer.textBoxBounds(wrapped),
      singleInk: paintedRows(single),
      fourInk: paintedRows(four),
    };
  });

  expect(result.single.width).toBeLessThan(1);
  expect(result.wide.width).toBeGreaterThan(result.single.width);
  expect(result.four.height).toBeGreaterThan(result.single.height);
  expect(result.wrapped.x + result.wrapped.width).toBeLessThanOrEqual(8);
  expect(result.wrapped.y + result.wrapped.height).toBeLessThanOrEqual(6);
  expect(result.wrapped.height).toBeGreaterThan(result.single.height);
  expect(result.singleInk.some((y) => y < 0.2)).toBe(true);
  for (let line = 0; line < 4; line += 1) {
    expect(result.fourInk.some((y) => y >= line * 0.26 && y < (line + 1) * 0.26)).toBe(true);
  }
});
