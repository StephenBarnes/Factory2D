import { TILE_DEFINITIONS, TileKind } from "../simulation/tile";

export interface PricedComponent {
  readonly kind: TileKind;
  readonly price: number;
}

export class PuzzleComponents {
  readonly entries: readonly PricedComponent[];
  private readonly pricesByKind: readonly (number | undefined)[];

  constructor(entries: readonly PricedComponent[]) {
    const pricesByKind: (number | undefined)[] = [];
    for (const entry of entries) {
      const definition = TILE_DEFINITIONS[entry.kind];
      if (entry.kind === TileKind.Empty || definition.palette === null) {
        throw new Error(`${definition.name} cannot be a puzzle component`);
      }
      if (!Number.isSafeInteger(entry.price) || entry.price < 0) {
        throw new Error(`Price for ${definition.name} must be a non-negative safe integer`);
      }
      if (pricesByKind[entry.kind] !== undefined) {
        throw new Error(`${definition.name} is listed more than once`);
      }
      pricesByKind[entry.kind] = entry.price;
    }

    this.entries = Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
    this.pricesByKind = pricesByKind;
  }

  has(kind: TileKind): boolean {
    return this.pricesByKind[kind] !== undefined;
  }

  priceOf(kind: TileKind): number | null {
    return this.pricesByKind[kind] ?? null;
  }
}
