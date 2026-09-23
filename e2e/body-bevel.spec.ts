import { expect, test } from "@playwright/test";

import type { BodyCell, drawBody as DrawBody } from "../src/render/tile-renderer";
import type { tileAppearance as Appearance } from "../src/render/appearance";
import { Direction, TileKind, WeldSide } from "../src/simulation/tile";

test("isolated corners keep directional lighting in both outline modes", async ({ page }) => {
  await page.goto("/");
  const samples = await page.evaluate(async ({ kind, orientation, connections }) => {
    // Load in the page's Canvas realm; static Node imports cannot draw there.
    const rendererPath = "/src/render/tile-renderer.ts";
    const appearancePath = "/src/render/appearance.ts";
    const { drawBody } = await import(/* @vite-ignore */ rendererPath) as
      { drawBody: typeof DrawBody };
    const { tileAppearance } = await import(/* @vite-ignore */ appearancePath) as
      { tileAppearance: typeof Appearance };
    const previous = { ...tileAppearance };
    try {
      const cell: BodyCell = {
        x: 0, y: 0, kind, orientation, outputCharge: 0, circuitPortCharges: 0,
        circuitConnections: connections, seamRight: false, seamDown: false,
      };
      return [false, true].map((angular) => {
        tileAppearance.angularOutlines = angular;
        tileAppearance.bevels = true;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 120;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#241b14";
        context.fillRect(0, 0, 120, 120);
        drawBody(context, 12, 12, 96, [cell]);
        const brightness = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[0]!;
        return {
          angular,
          face: brightness(60, 60),
          litCorner: brightness(angular ? 24 : 21, angular ? 24 : 21),
          shadedCorner: brightness(angular ? 95 : 98, angular ? 95 : 98),
        };
      });
    } finally {
      Object.assign(tileAppearance, previous);
    }
  }, { kind: TileKind.Platform, orientation: Direction.Up, connections: WeldSide.None });

  for (const { face, litCorner, shadedCorner } of samples) {
    expect(litCorner).toBeGreaterThan(face + 10);
    expect(shadedCorner).toBeLessThan(face - 10);
  }
});
