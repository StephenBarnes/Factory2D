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
    expect(shortcutLabels(palette)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
      ...Array.from({ length: buttons.length - 10 }, () => null),
    ]);
    for (let index = 0; index < 10; index += 1) {
      expect(shortcuts[`Digit${(index + 1) % 10}`]).toBe(Number(buttons[index]?.dataset.tile));
    }
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
