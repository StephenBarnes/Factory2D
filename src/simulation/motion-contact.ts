import { TILE_DEFINITIONS, TileKind } from "./tile";

export const enum ContactDestruction {
  None = 0,
  Source = 1,
  Target = 2,
  Both = Source | Target,
}

/** A destructive contact replaces a solid collision, never destruction immunity. */
export function contactDestruction(source: TileKind, target: TileKind): ContactDestruction {
  if (source === TileKind.Empty || target === TileKind.Empty) return ContactDestruction.None;
  const sourceDefinition = TILE_DEFINITIONS[source];
  const targetDefinition = TILE_DEFINITIONS[target];
  return (targetDefinition.destroysOnContact && !sourceDefinition.indestructible
    ? ContactDestruction.Source : 0) |
    (sourceDefinition.destroysOnContact && !targetDefinition.indestructible
      ? ContactDestruction.Target : 0);
}
