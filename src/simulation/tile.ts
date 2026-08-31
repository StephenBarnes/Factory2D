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
  ChargeSensor = 13,
  Selector = 14,
  WireCrossing = 15,
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
  ChargeSensor = 12,
  Selector = 13,
  WireCrossing = 14,
}

export interface TileDefinition {
  readonly name: string;
  /** Single UTF-16 code unit used by the compact board format. */
  readonly boardCode: string;
  /** Sandbox component-palette presentation. Empty tiles are not palette entries. */
  readonly palette: {
    readonly order: number;
    readonly description: string;
    readonly shortcut: {
      readonly code: string;
      readonly label: string;
    } | null;
  } | null;
  readonly affectedByGravity: boolean;
  readonly weldableSides: WeldSide;
  readonly excludesFacingWeld: boolean;
  readonly usesOrientation: boolean;
  readonly circuitPorts: WeldSide;
  /** Isolated input or sensing ports relative to an upward-facing tile. */
  readonly circuitInputPorts: WeldSide;
  /** Isolated output ports relative to an upward-facing tile. */
  readonly circuitOutputPorts: WeldSide;
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
    boardCode: ".",
    palette: null,
    affectedByGravity: false,
    slidesDiagonally: false,
    weldableSides: WeldSide.None,
    excludesFacingWeld: false,
    usesOrientation: false,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
    circuitOutputPorts: WeldSide.None,
    magnetic: false,
    attractionRange: 0,
    fill: "transparent",
    shadow: "transparent",
    decorationStyle: TileDecorationStyle.None,
    decorationColor: "transparent",
  },
  [TileKind.Stone]: {
    name: "Stone",
    boardCode: "#",
    palette: {
      order: 1,
      description: "Solid block affected by gravity",
      shortcut: { code: "Digit2", label: "2" },
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: false,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
    circuitOutputPorts: WeldSide.None,
    magnetic: false,
    attractionRange: 0,
    fill: "#66717d",
    shadow: "#3c454f",
    decorationStyle: TileDecorationStyle.Crack,
    decorationColor: "#525d68",
  },
  [TileKind.Sand]: {
    name: "Sand",
    boardCode: ":",
    palette: {
      order: 0,
      description: "Falls and slides around obstacles",
      shortcut: { code: "Digit1", label: "1" },
    },
    affectedByGravity: true,
    slidesDiagonally: true,
    weldableSides: WeldSide.None,
    excludesFacingWeld: false,
    usesOrientation: false,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
    circuitOutputPorts: WeldSide.None,
    magnetic: false,
    attractionRange: 0,
    fill: "#e7ad4f",
    shadow: "#a86d2b",
    decorationStyle: TileDecorationStyle.Grains,
    decorationColor: "#8d5b26",
  },
  [TileKind.Platform]: {
    name: "Platform",
    boardCode: "=",
    palette: {
      order: 2,
      description: "Fixed structural block",
      shortcut: { code: "Digit3", label: "3" },
    },
    affectedByGravity: false,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: false,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
    circuitOutputPorts: WeldSide.None,
    magnetic: false,
    attractionRange: 0,
    fill: "#56736b",
    shadow: "#30473f",
    decorationStyle: TileDecorationStyle.Crack,
    decorationColor: "#405b52",
  },
  [TileKind.Magnet]: {
    name: "Magnet",
    boardCode: "L",
    palette: {
      order: 3,
      description: "Holds magnetic blocks on its pointed side",
      shortcut: { code: "Digit4", label: "4" },
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: true,
    usesOrientation: true,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
    circuitOutputPorts: WeldSide.None,
    magnetic: false,
    attractionRange: 1,
    fill: "#b94b52",
    shadow: "#6e2930",
    decorationStyle: TileDecorationStyle.Magnet,
    decorationColor: "#f3e5c8",
  },
  [TileKind.Metal]: {
    name: "Metal",
    boardCode: "M",
    palette: {
      order: 4,
      description: "Magnetic structural block",
      shortcut: { code: "Digit5", label: "5" },
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: false,
    circuitPorts: WeldSide.None,
    circuitInputPorts: WeldSide.None,
    circuitOutputPorts: WeldSide.None,
    magnetic: true,
    attractionRange: 0,
    fill: "#718a9b",
    shadow: "#405767",
    decorationStyle: TileDecorationStyle.Metal,
    decorationColor: "#d5e1e7",
  },
  [TileKind.Conduit]: {
    name: "Conduit",
    boardCode: "C",
    palette: {
      order: 5,
      description: "Shares charge across welded circuit blocks",
      shortcut: { code: "Digit6", label: "6" },
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: false,
    circuitPorts: WeldSide.All,
    circuitInputPorts: WeldSide.None,
    circuitOutputPorts: WeldSide.None,
    magnetic: false,
    attractionRange: 0,
    fill: "#69727b",
    shadow: "#3b4249",
    decorationStyle: TileDecorationStyle.Conduit,
    decorationColor: "#162f4b",
  },
  [TileKind.Sensor]: {
    name: "Sensor Rune",
    boardCode: "S",
    palette: {
      order: 6,
      description: "Emits +1 when its pointed side is occupied",
      shortcut: { code: "Digit7", label: "7" },
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.Right | WeldSide.Down | WeldSide.Left,
    circuitInputPorts: WeldSide.None,
    circuitOutputPorts: WeldSide.None,
    magnetic: false,
    attractionRange: 0,
    fill: "#675d77",
    shadow: "#393345",
    decorationStyle: TileDecorationStyle.Sensor,
    decorationColor: "#d9c8ff",
  },
  [TileKind.Inverter]: {
    name: "Inverter Rune",
    boardCode: "I",
    palette: {
      order: 7,
      description: "Negates the sum of up to three isolated inputs",
      shortcut: { code: "Digit8", label: "8" },
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.All,
    circuitInputPorts: WeldSide.Right | WeldSide.Down | WeldSide.Left,
    circuitOutputPorts: WeldSide.Up,
    magnetic: false,
    attractionRange: 0,
    fill: "#765878",
    shadow: "#443047",
    decorationStyle: TileDecorationStyle.Inverter,
    decorationColor: "#ead2ef",
  },
  [TileKind.Combiner]: {
    name: "Combiner Rune",
    boardCode: "+",
    palette: {
      order: 8,
      description: "Sums up to three isolated inputs toward its output",
      shortcut: { code: "Digit9", label: "9" },
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.All,
    circuitInputPorts: WeldSide.Right | WeldSide.Down | WeldSide.Left,
    circuitOutputPorts: WeldSide.Up,
    magnetic: false,
    attractionRange: 0,
    fill: "#526f69",
    shadow: "#2e413d",
    decorationStyle: TileDecorationStyle.Combiner,
    decorationColor: "#d2f0df",
  },
  [TileKind.Rectifier]: {
    name: "Rectifier Rune",
    boardCode: "R",
    palette: {
      order: 9,
      description: "Passes positive sums from up to three isolated inputs",
      shortcut: { code: "Digit0", label: "0" },
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.All,
    circuitInputPorts: WeldSide.Right | WeldSide.Down | WeldSide.Left,
    circuitOutputPorts: WeldSide.Up,
    magnetic: false,
    attractionRange: 0,
    fill: "#786448",
    shadow: "#463821",
    decorationStyle: TileDecorationStyle.Rectifier,
    decorationColor: "#f1dfb8",
  },
  [TileKind.Multiplier]: {
    name: "Multiplier Rune",
    boardCode: "*",
    palette: {
      order: 10,
      description: "Multiplies up to three connected isolated inputs",
      shortcut: { code: "KeyX", label: "X" },
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.All,
    circuitInputPorts: WeldSide.Right | WeldSide.Down | WeldSide.Left,
    circuitOutputPorts: WeldSide.Up,
    magnetic: false,
    attractionRange: 0,
    fill: "#51657b",
    shadow: "#2d3a49",
    decorationStyle: TileDecorationStyle.Multiplier,
    decorationColor: "#d4e4f5",
  },
  [TileKind.Subtractor]: {
    name: "Subtractor Rune",
    boardCode: "-",
    palette: {
      order: 11,
      description: "Subtracts left and right inputs from the rear input",
      shortcut: { code: "Minus", label: "−" },
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.All,
    circuitInputPorts: WeldSide.Right | WeldSide.Down | WeldSide.Left,
    circuitOutputPorts: WeldSide.Up,
    magnetic: false,
    attractionRange: 0,
    fill: "#745b50",
    shadow: "#44332c",
    decorationStyle: TileDecorationStyle.Subtractor,
    decorationColor: "#f0d7ca",
  },
  [TileKind.ChargeSensor]: {
    name: "Charge Sensor Rune",
    boardCode: "Q",
    palette: {
      order: 12,
      description: "Copies an adjacent tile's charge to three outputs without an input weld",
      shortcut: null,
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.All,
    circuitInputPorts: WeldSide.Up,
    circuitOutputPorts: WeldSide.Right | WeldSide.Down | WeldSide.Left,
    magnetic: false,
    attractionRange: 0,
    fill: "#4f6f78",
    shadow: "#2b4047",
    decorationStyle: TileDecorationStyle.ChargeSensor,
    decorationColor: "#d3eff4",
  },
  [TileKind.Selector]: {
    name: "Selector Rune",
    boardCode: "T",
    palette: {
      order: 13,
      description: "Selects the left or right input from the rear charge",
      shortcut: null,
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: true,
    circuitPorts: WeldSide.All,
    circuitInputPorts: WeldSide.Right | WeldSide.Down | WeldSide.Left,
    circuitOutputPorts: WeldSide.Up,
    magnetic: false,
    attractionRange: 0,
    fill: "#5f587b",
    shadow: "#363047",
    decorationStyle: TileDecorationStyle.Selector,
    decorationColor: "#e2dcfa",
  },
  [TileKind.WireCrossing]: {
    name: "Wire Crossing",
    boardCode: "W",
    palette: {
      order: 14,
      description: "Keeps horizontal and vertical circuit networks separate",
      shortcut: null,
    },
    affectedByGravity: true,
    slidesDiagonally: false,
    weldableSides: WeldSide.All,
    excludesFacingWeld: false,
    usesOrientation: false,
    circuitPorts: WeldSide.All,
    circuitInputPorts: WeldSide.None,
    circuitOutputPorts: WeldSide.None,
    magnetic: false,
    attractionRange: 0,
    fill: "#526875",
    shadow: "#2d3b43",
    decorationStyle: TileDecorationStyle.WireCrossing,
    decorationColor: "#d5e9f2",
  },
};

export const TILE_KINDS: readonly TileKind[] = Object.freeze(
  Object.keys(TILE_DEFINITIONS).map((value) => Number(value) as TileKind),
);

export function isTileKind(value: number): value is TileKind {
  return Number.isInteger(value) && Object.hasOwn(TILE_DEFINITIONS, value);
}

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
