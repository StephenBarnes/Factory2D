import { TILE_DEFINITIONS, TILE_KINDS, TileKind } from "../simulation/tile";

export function populateComponentPalette(
  container: HTMLElement,
  selectedKind: TileKind,
): Readonly<Record<string, TileKind | undefined>> {
  const paletteKinds = TILE_KINDS
    .filter((kind) => TILE_DEFINITIONS[kind].palette !== null)
    .sort((left, right) => {
      const leftPalette = TILE_DEFINITIONS[left].palette;
      const rightPalette = TILE_DEFINITIONS[right].palette;
      if (leftPalette === null || rightPalette === null) {
        throw new Error("Palette kind is missing palette metadata");
      }
      return leftPalette.order - rightPalette.order;
    });
  const shortcutKinds = Object.create(null) as Record<string, TileKind | undefined>;
  let previousOrder: number | null = null;

  container.replaceChildren();
  for (const kind of paletteKinds) {
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
    detail.textContent = palette.description;
    description.append(name, detail);
    button.append(preview, description);

    if (palette.shortcut !== null) {
      if (Object.hasOwn(shortcutKinds, palette.shortcut.code)) {
        throw new Error(`Duplicate component shortcut ${palette.shortcut.code}`);
      }
      shortcutKinds[palette.shortcut.code] = kind;
      const shortcut = document.createElement("kbd");
      shortcut.textContent = palette.shortcut.label;
      button.append(shortcut);
    }
    container.append(button);
  }

  return shortcutKinds;
}
