export const enum TileKind {
  Empty = 0,
  Stone = 1,
  Sand = 2,
  Platform = 3,
  Magnet = 4,
  Metal = 5,
}

export const enum Direction {
  Up = 0,
  Right = 1,
  Down = 2,
  Left = 3,
}

export const enum WeldSide {
  None = 0,
  Up = 1 << Direction.Up,
  Right = 1 << Direction.Right,
  Down = 1 << Direction.Down,
  Left = 1 << Direction.Left,
  All = Up | Right | Down | Left,
}

export const enum TileDecorationStyle {
  None = 0,
  Crack = 1,
  Grains = 2,
  Magnet = 3,
  Metal = 4,
}

export interface TileDefinition {
  readonly name: string;
  readonly affectedByGravity: boolean;
  readonly weldableSides: WeldSide;
  readonly excludesFacingWeld: boolean;
  readonly slidesDiagonally: boolean;
  readonly magnetic: boolean;
  readonly attractionRange: number;
  readonly fill: string;
  readonly shadow: string;
  readonly decorationStyle: TileDecorationStyle;
  readonly decorationColor: string;
}

export function directionX(direction: Direction): -1 | 0 | 1 {
  return direction === Direction.Right ? 1 : direction === Direction.Left ? -1 : 0;
}

export function directionY(direction: Direction): -1 | 0 | 1 {
  return direction === Direction.Down ? 1 : direction === Direction.Up ? -1 : 0;
}

export function oppositeDirection(direction: Direction): Direction {
  return ((direction + 2) & 3) as Direction;
}

export const TILE_DEFINITIONS: Readonly<Record<TileKind, TileDefinition>> = {
  [TileKind.Empty]: {
    name: "Empty",
    affectedByGravity: false,
    slidesDiagonally: false,
    weldableSides: WeldSide.None,
    excludesFacingWeld: false,
    magnetic: false,
    attractionRange: 0,
    fill: "transparent",
    shadow: "transparent",
    decorationStyle: TileDecorationStyle.None,
    decorationColor: "transparent",
  },
  [TileKind.Stone]: {
    name: "Stone",
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    magnetic: false,
    attractionRange: 0,
    fill: "#66717d",
    shadow: "#3c454f",
    decorationStyle: TileDecorationStyle.Crack,
    decorationColor: "#525d68",
  },
  [TileKind.Sand]: {
    name: "Sand",
    affectedByGravity: true,
    slidesDiagonally: true,
    weldableSides: WeldSide.None,
    excludesFacingWeld: false,
    magnetic: false,
    attractionRange: 0,
    fill: "#e7ad4f",
    shadow: "#a86d2b",
    decorationStyle: TileDecorationStyle.Grains,
    decorationColor: "#8d5b26",
  },
  [TileKind.Platform]: {
    name: "Platform",
    affectedByGravity: false,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    magnetic: false,
    attractionRange: 0,
    fill: "#56736b",
    shadow: "#30473f",
    decorationStyle: TileDecorationStyle.Crack,
    decorationColor: "#405b52",
  },
  [TileKind.Magnet]: {
    name: "Magnet",
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: true,
    magnetic: false,
    attractionRange: 1,
    fill: "#b94b52",
    shadow: "#6e2930",
    decorationStyle: TileDecorationStyle.Magnet,
    decorationColor: "#f3e5c8",
  },
  [TileKind.Metal]: {
    name: "Metal",
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    magnetic: true,
    attractionRange: 0,
    fill: "#718a9b",
    shadow: "#405767",
    decorationStyle: TileDecorationStyle.Metal,
    decorationColor: "#d5e1e7",
  },
};
