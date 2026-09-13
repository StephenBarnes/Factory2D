import type { ConfigurableComponentSnapshot } from "../simulation/configurable-components";
import type { TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";

/** Copies only E-dialog settings, never the source's runtime state or display order. */
export function copyComponentConfiguration(
  world: World,
  x: number,
  y: number,
  kind: TileKind,
  source: ConfigurableComponentSnapshot,
): boolean {
  if (world.kindAt(x, y) !== kind) return false;
  switch (source.type) {
    case "delay":
    case "discard":
      return world.configureNumericComponent(x, y, source.length);
    case "counter":
      return world.configureNumericComponent(x, y, source.threshold);
    case "monitor":
    case "grapher":
      return world.configureSignalLabel(x, y, source.label, source.category);
    case "rom":
    case "lut":
    case "checker":
      return world.configureTernaryGrid(
        x, y, source.width, source.height, source.values,
        source.type === "checker" ? { ignoreZeros: source.ignoreZeros } :
          source.type === "rom" ? { wrapX: source.wrapX, wrapY: source.wrapY } : {},
      );
    case "array":
      return world.configureRuneArray(
        x, y, source.world.width, source.world.height, source.description,
      );
    case "assembler":
    case "rotator":
    case "fragile":
      throw new Error(`${source.type} has no player-editable configuration`);
  }
}
