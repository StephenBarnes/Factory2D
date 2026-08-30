export const enum TileKind {
  Empty = 0,
  Stone = 1,
  Sand = 2,
  Platform = 3,
  Magnet = 4,
  Metal = 5,
  Conduit = 6,
  Sensor = 7,
  Inverter = 8,
  Combiner = 9,
  Rectifier = 10,
  Multiplier = 11,
  Subtractor = 12,
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
  Conduit = 5,
  Sensor = 6,
  Inverter = 7,
  Combiner = 8,
  Rectifier = 9,
  Multiplier = 10,
  Subtractor = 11,
}

export interface TileDefinition {
  readonly name: string;
  readonly affectedByGravity: boolean;
  readonly weldableSides: WeldSide;
  readonly excludesFacingWeld: boolean;
  readonly usesOrientation: boolean;
  readonly circuitPorts: WeldSide;
  /** Gate input ports relative to an upward-facing tile; each remains an isolated network. */
  readonly circuitInputPorts: WeldSide;
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
    usesOrientation: false,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
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
    usesOrientation: false,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
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
    usesOrientation: false,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
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
    usesOrientation: false,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
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
    usesOrientation: true,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
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
    usesOrientation: false,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
    magnetic: true,
    attractionRange: 0,
    fill: "#718a9b",
    shadow: "#405767",
    decorationStyle: TileDecorationStyle.Metal,
    decorationColor: "#d5e1e7",
  },
  [TileKind.Conduit]: {
    name: "Conduit",
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: false,
    circuitPorts: WeldSide.All,
    circuitInputPorts: WeldSide.None,
    magnetic: false,
    attractionRange: 0,
    fill: "#69727b",
    shadow: "#3b4249",
    decorationStyle: TileDecorationStyle.Conduit,
    decorationColor: "#162f4b",
  },
  [TileKind.Sensor]: {
    name: "Sensor Rune",
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.Right | WeldSide.Down | WeldSide.Left,
    circuitInputPorts: WeldSide.None,
    magnetic: false,
    attractionRange: 0,
    fill: "#675d77",
    shadow: "#393345",
    decorationStyle: TileDecorationStyle.Sensor,
    decorationColor: "#d9c8ff",
  },
  [TileKind.Inverter]: {
    name: "Inverter Rune",
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.Up | WeldSide.Down,
    circuitInputPorts: WeldSide.Down,
    magnetic: false,
    attractionRange: 0,
    fill: "#765878",
    shadow: "#443047",
    decorationStyle: TileDecorationStyle.Inverter,
    decorationColor: "#ead2ef",
  },
  [TileKind.Combiner]: {
    name: "Combiner Rune",
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.All,
    circuitInputPorts: WeldSide.Right | WeldSide.Down | WeldSide.Left,
    magnetic: false,
    attractionRange: 0,
    fill: "#526f69",
    shadow: "#2e413d",
    decorationStyle: TileDecorationStyle.Combiner,
    decorationColor: "#d2f0df",
  },
  [TileKind.Rectifier]: {
    name: "Rectifier Rune",
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.Up | WeldSide.Down,
    circuitInputPorts: WeldSide.Down,
    magnetic: false,
    attractionRange: 0,
    fill: "#786448",
    shadow: "#463821",
    decorationStyle: TileDecorationStyle.Rectifier,
    decorationColor: "#f1dfb8",
  },
  [TileKind.Multiplier]: {
    name: "Multiplier Rune",
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.Up | WeldSide.Right | WeldSide.Left,
    circuitInputPorts: WeldSide.Right | WeldSide.Left,
    magnetic: false,
    attractionRange: 0,
    fill: "#51657b",
    shadow: "#2d3a49",
    decorationStyle: TileDecorationStyle.Multiplier,
    decorationColor: "#d4e4f5",
  },
  [TileKind.Subtractor]: {
    name: "Subtractor Rune",
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.Up | WeldSide.Right | WeldSide.Left,
    circuitInputPorts: WeldSide.Right | WeldSide.Left,
    magnetic: false,
    attractionRange: 0,
    fill: "#745b50",
    shadow: "#44332c",
    decorationStyle: TileDecorationStyle.Subtractor,
    decorationColor: "#f0d7ca",
  },
};

export function orientationForKind(kind: TileKind, orientation: Direction): Direction {
  return TILE_DEFINITIONS[kind].usesOrientation ? orientation : Direction.Up;
}

/** Rotates a side mask from its upward-facing definition to a tile's orientation. */
export function orientedSides(sides: WeldSide, orientation: Direction): WeldSide {
  return (
    ((sides << orientation) | (sides >> (4 - orientation))) &
    WeldSide.All
  ) as WeldSide;
}
