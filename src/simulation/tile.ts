export const enum TileKind {
  Empty = 0,
  Stone = 1,
  Sand = 2,
}

export interface TileDefinition {
  readonly name: string;
  readonly affectedByGravity: boolean;
  readonly fill: string;
  readonly highlight: string;
  readonly shadow: string;
}

export const TILE_DEFINITIONS: Readonly<Record<TileKind, TileDefinition>> = {
  [TileKind.Empty]: {
    name: "Empty",
    affectedByGravity: false,
    fill: "transparent",
    highlight: "transparent",
    shadow: "transparent",
  },
  [TileKind.Stone]: {
    name: "Stone",
    affectedByGravity: false,
    fill: "#66717d",
    highlight: "#95a0ab",
    shadow: "#3c454f",
  },
  [TileKind.Sand]: {
    name: "Sand",
    affectedByGravity: true,
    fill: "#e7ad4f",
    highlight: "#ffd37a",
    shadow: "#a86d2b",
  },
};
