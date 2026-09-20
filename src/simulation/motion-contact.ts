import { TILE_DEFINITIONS, TileKind } from "./tile";

export const enum ContactDestruction {
  None = 0,
  Source = 1,
  Target = 2,
  Both = Source | Target,
}

/** A destructive contact replaces a solid collision, never destruction immunity. */
export function contactDestruction(source: TileKind, target: TileKind): ContactDestruction {
  if ((source !== TileKind.Destroyer && target !== TileKind.Destroyer) ||
      source === TileKind.Empty || target === TileKind.Empty ||
      TILE_DEFINITIONS[source].indestructible || TILE_DEFINITIONS[target].indestructible) {
    return ContactDestruction.None;
  }
  return (target === TileKind.Destroyer ? ContactDestruction.Source : 0) |
    (source === TileKind.Destroyer ? ContactDestruction.Target : 0);
}
