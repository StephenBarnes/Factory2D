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
  readonly attributes: Record<string, string> = {};
  title = "";
  type = "";
  width = 0;
  height = 0;

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

function createPalette(): FakeElement {
  return new FakeElement();
}

function paletteSections(palette: FakeElement): FakeElement[] {
  return palette.children;
}

function paletteButtons(palette: FakeElement): FakeElement[] {
  return paletteSections(palette).flatMap((section) => section.children[1]?.children ?? []);
}

function shortcutLabels(palette: FakeElement): (string | null)[] {
  return paletteButtons(palette).map((button) => button.children[1]?.textContent ?? null);
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

    const buttons = paletteButtons(palette);
    expect(buttons.slice(0, 10).map((button) => Number(button.dataset.tile))).toEqual([
      TileKind.Sand,
      TileKind.Stone,
      TileKind.Platform,
      TileKind.Iron,
      TileKind.Glass,
      TileKind.IronOre,
      TileKind.Magnet,
      TileKind.Furnace,
      TileKind.Conveyor,
      TileKind.Piston,
    ]);
    expect(shortcutLabels(palette)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
      ...Array.from({ length: buttons.length - 10 }, () => null),
    ]);
    expect(shortcuts).toMatchObject({
      Digit1: TileKind.Sand,
      Digit6: TileKind.IronOre,
      Digit8: TileKind.Furnace,
      Digit0: TileKind.Piston,
    });
  });

  it("groups compact component buttons by palette category", () => {
    const palette = createPalette();
    populateComponentPalette(
      palette as unknown as HTMLElement,
      TileKind.Conveyor,
    );

    expect(paletteSections(palette).map((section) => section.children[0]?.textContent)).toEqual([
      "Raw Materials",
      "Mechanisms",
      "Circuit Components",
      "Puzzle Tools",
    ]);
    expect(paletteButtons(palette).every((button) => button.className.includes("palette-tile"))).toBe(true);
    const conveyor = paletteButtons(palette).find(
      (button) => Number(button.dataset.tile) === TileKind.Conveyor,
    );
    expect(conveyor?.children).toHaveLength(2);
    expect(conveyor?.dataset).toMatchObject({ price: "", shortcut: "9" });
    expect(conveyor?.attributes["aria-label"]).toBe("Conveyor Belt (9)");
    expect(conveyor?.classList.values.has("selected")).toBe(true);
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

    expect(paletteButtons(palette).map((button) => Number(button.dataset.tile))).toEqual([
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
