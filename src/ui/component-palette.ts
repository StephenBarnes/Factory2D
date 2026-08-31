import type { PuzzleComponents } from "../game/puzzle-components";
import {
  PaletteCategory,
  TILE_DEFINITIONS,
  TILE_KINDS,
  TileKind,
} from "../simulation/tile";

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

const PALETTE_CATEGORIES = [
  { category: PaletteCategory.RawMaterials, label: "Raw Materials" },
  { category: PaletteCategory.Mechanisms, label: "Mechanisms" },
  { category: PaletteCategory.Circuits, label: "Circuit Components" },
  { category: PaletteCategory.Machines, label: "Machines" },
  { category: PaletteCategory.PuzzleTools, label: "Puzzle Tools" },
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
    return leftPalette.category - rightPalette.category ||
      leftPalette.order - rightPalette.order;
  });

  const shortcutKinds = Object.create(null) as Record<string, TileKind | undefined>;
  const usedOrders = new Set<number>();
  const grids = new Map<PaletteCategory, HTMLElement>();
  container.replaceChildren();

  for (const categoryDefinition of PALETTE_CATEGORIES) {
    const hasComponents = paletteComponents.some((component) => {
      const palette = TILE_DEFINITIONS[component.kind].palette;
      return palette !== null && palette.category === categoryDefinition.category;
    });
    if (!hasComponents) {
      continue;
    }

    const section = document.createElement("section");
    section.className = "palette-section";
    section.dataset.paletteCategory = String(categoryDefinition.category);
    const heading = document.createElement("h3");
    heading.className = "palette-category";
    heading.textContent = categoryDefinition.label;
    const grid = document.createElement("div");
    grid.className = "palette-grid";
    section.append(heading, grid);
    container.append(section);
    grids.set(categoryDefinition.category, grid);
  }

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
    if (usedOrders.has(palette.order)) {
      throw new Error(`Duplicate component palette order ${palette.order}`);
    }
    usedOrders.add(palette.order);

    const button = document.createElement("button");
    button.className = "palette-item palette-tile";
    button.classList.toggle("selected", kind === selectedKind);
    button.dataset.tile = String(kind);
    button.dataset.price = component.price === null ? "" : String(component.price);
    button.type = "button";

    const preview = document.createElement("canvas");
    preview.className = "tile-preview";
    preview.dataset.tilePreview = String(kind);
    preview.width = 40;
    preview.height = 40;
    button.append(preview);

    const shortcutDefinition = PALETTE_SHORTCUTS[index];
    button.dataset.shortcut = shortcutDefinition?.label ?? "";
    button.setAttribute(
      "aria-label",
      shortcutDefinition === undefined
        ? definition.name
        : `${definition.name} (${shortcutDefinition.label})`,
    );
    button.title = definition.name;
    if (shortcutDefinition !== undefined) {
      shortcutKinds[shortcutDefinition.code] = kind;
      const shortcut = document.createElement("kbd");
      shortcut.textContent = shortcutDefinition.label;
      button.append(shortcut);
    }

    const grid = grids.get(palette.category);
    if (grid === undefined) {
      throw new Error(`Palette category for ${definition.name} is not configured`);
    }
    grid.append(button);
  }

  return shortcutKinds;
}
