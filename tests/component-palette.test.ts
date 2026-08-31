import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PuzzleComponents } from "../src/game/puzzle-components";
import { TileKind } from "../src/simulation/tile";
import { populateComponentPalette } from "../src/ui/component-palette";

class FakeClassList {
  readonly values = new Set<string>();

  toggle(name: string, force: boolean): void {
    if (force) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }
  }
}

class FakeElement {
  className = "";
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  textContent = "";
  type = "";
  width = 0;
  height = 0;

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }
}

function createPalette(): FakeElement {
  return new FakeElement();
}

function shortcutLabels(palette: FakeElement): (string | null)[] {
  return palette.children.map((button) => {
    const shortcut = button.children[2];
    return shortcut?.textContent ?? null;
  });
}

describe("component palette shortcuts", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("assigns 1 through 0 to the first ten sandbox components", () => {
    const palette = createPalette();
    const shortcuts = populateComponentPalette(
      palette as unknown as HTMLElement,
      null,
    );

    expect(palette.children.slice(0, 10).map((button) => Number(button.dataset.tile))).toEqual([
      TileKind.Sand,
      TileKind.Stone,
      TileKind.Platform,
      TileKind.Magnet,
      TileKind.Iron,
      TileKind.Glass,
      TileKind.IronOre,
      TileKind.Furnace,
      TileKind.Conveyor,
      TileKind.Conduit,
    ]);
    expect(shortcutLabels(palette)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
      ...Array.from({ length: palette.children.length - 10 }, () => null),
    ]);
    expect(shortcuts).toMatchObject({
      Digit1: TileKind.Sand,
      Digit6: TileKind.Glass,
      Digit0: TileKind.Conduit,
    });
  });

  it("reassigns shortcuts from each puzzle palette's visible order", () => {
    const palette = createPalette();
    const shortcuts = populateComponentPalette(
      palette as unknown as HTMLElement,
      null,
      new PuzzleComponents([
        { kind: TileKind.FixedCharge, price: 2 },
        { kind: TileKind.Conveyor, price: 5 },
        { kind: TileKind.Stone, price: 1 },
      ]),
    );

    expect(palette.children.map((button) => Number(button.dataset.tile))).toEqual([
      TileKind.Stone,
      TileKind.Conveyor,
      TileKind.FixedCharge,
    ]);
    expect(shortcutLabels(palette)).toEqual(["1", "2", "3"]);
    expect(shortcuts).toMatchObject({
      Digit1: TileKind.Stone,
      Digit2: TileKind.Conveyor,
      Digit3: TileKind.FixedCharge,
    });
  });
});
