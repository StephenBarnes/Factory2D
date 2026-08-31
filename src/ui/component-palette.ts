import type { PuzzleComponents } from "../game/puzzle-components";
import { TILE_DEFINITIONS, TILE_KINDS, TileKind } from "../simulation/tile";

const PALETTE_SHORTCUTS = [
  { code: "Digit1", label: "1" },
  { code: "Digit2", label: "2" },
  { code: "Digit3", label: "3" },
  { code: "Digit4", label: "4" },
  { code: "Digit5", label: "5" },
  { code: "Digit6", label: "6" },
  { code: "Digit7", label: "7" },
  { code: "Digit8", label: "8" },
  { code: "Digit9", label: "9" },
  { code: "Digit0", label: "0" },
] as const;

export function populateComponentPalette(
  container: HTMLElement,
  selectedKind: TileKind | null,
  availableComponents: PuzzleComponents | null = null,
): Readonly<Record<string, TileKind | undefined>> {
  const paletteComponents = availableComponents === null
    ? TILE_KINDS
      .filter((kind) => TILE_DEFINITIONS[kind].palette !== null)
      .map((kind) => ({ kind, price: null }))
    : [...availableComponents.entries];
  paletteComponents.sort((left, right) => {
    const leftPalette = TILE_DEFINITIONS[left.kind].palette;
    const rightPalette = TILE_DEFINITIONS[right.kind].palette;
    if (leftPalette === null || rightPalette === null) {
      throw new Error("Palette kind is missing palette metadata");
    }
    return leftPalette.order - rightPalette.order;
  });
  const shortcutKinds = Object.create(null) as Record<string, TileKind | undefined>;
  let previousOrder: number | null = null;

  container.replaceChildren();
  for (const [index, component] of paletteComponents.entries()) {
    const kind = component.kind;
    const definition = TILE_DEFINITIONS[kind];
    const palette = definition.palette;
    if (palette === null) {
      throw new Error(`${definition.name} is missing palette metadata`);
    }
    if (!Number.isSafeInteger(palette.order) || palette.order < 0) {
      throw new Error(`Palette order for ${definition.name} must be a non-negative integer`);
    }
    if (palette.order === previousOrder) {
      throw new Error(`Duplicate component palette order ${palette.order}`);
    }
    previousOrder = palette.order;

    const button = document.createElement("button");
    button.className = "palette-item";
    button.classList.toggle("selected", kind === selectedKind);
    button.dataset.tile = String(kind);
    button.type = "button";

    const preview = document.createElement("canvas");
    preview.className = "tile-preview";
    preview.dataset.tilePreview = String(kind);
    preview.width = 32;
    preview.height = 32;

    const description = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = definition.name;
    const detail = document.createElement("small");
    detail.textContent = component.price === null
      ? palette.description
      : `${palette.description} · Cost ${component.price}`;
    description.append(name, detail);
    button.append(preview, description);

    const shortcutDefinition = PALETTE_SHORTCUTS[index];
    if (shortcutDefinition !== undefined) {
      shortcutKinds[shortcutDefinition.code] = kind;
      const shortcut = document.createElement("kbd");
      shortcut.textContent = shortcutDefinition.label;
      button.append(shortcut);
    }
    container.append(button);
  }

  return shortcutKinds;
}
