export const enum TileKind {
  Empty = 0,
  Stone = 1,
  Sand = 2,
  Platform = 3,
}

export const enum TileDecorationStyle {
  None = 0,
  Crack = 1,
  Grains = 2,
}

export interface TileDefinition {
  readonly name: string;
  readonly affectedByGravity: boolean;
  readonly weldable: boolean;
  readonly slidesDiagonally: boolean;
  readonly fill: string;
  readonly highlight: string;
  readonly shadow: string;
  readonly decorationStyle: TileDecorationStyle;
  readonly decorationColor: string;
}

export const TILE_DEFINITIONS: Readonly<Record<TileKind, TileDefinition>> = {
  [TileKind.Empty]: {
    name: "Empty",
    affectedByGravity: false,
    slidesDiagonally: false,
    weldable: false,
    fill: "transparent",
    highlight: "transparent",
    shadow: "transparent",
    decorationStyle: TileDecorationStyle.None,
    decorationColor: "transparent",
  },
  [TileKind.Stone]: {
    name: "Stone",
    affectedByGravity: true,
    slidesDiagonally: false,
    weldable: true,
    fill: "#66717d",
    highlight: "#95a0ab",
    shadow: "#3c454f",
    decorationStyle: TileDecorationStyle.Crack,
    decorationColor: "#525d68",
  },
  [TileKind.Sand]: {
    name: "Sand",
    affectedByGravity: true,
    slidesDiagonally: true,
    weldable: false,
    fill: "#e7ad4f",
    highlight: "#ffd37a",
    shadow: "#a86d2b",
    decorationStyle: TileDecorationStyle.Grains,
    decorationColor: "#8d5b26",
  },
  [TileKind.Platform]: {
    name: "Platform",
    affectedByGravity: false,
    slidesDiagonally: false,
    weldable: true,
    fill: "#56736b",
    highlight: "#85a49a",
    shadow: "#30473f",
    decorationStyle: TileDecorationStyle.Crack,
    decorationColor: "#405b52",
  },
};
