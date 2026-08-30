import { TileKind } from "./tile";

export interface Tile {
  readonly kind: TileKind;
  readonly id: number;
}

export class World {
  readonly width: number;
  readonly height: number;
  readonly cellCount: number;

  private readonly kinds: Uint8Array;
  private readonly ids: Uint32Array;
  private nextTileId = 1;

  constructor(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("World dimensions must be positive integers");
    }

    this.width = width;
    this.height = height;
    this.cellCount = width * height;
    this.kinds = new Uint8Array(this.cellCount);
    this.ids = new Uint32Array(this.cellCount);
  }

  kindAt(x: number, y: number): TileKind {
    return this.kinds[this.indexOf(x, y)] as TileKind;
  }

  idAt(x: number, y: number): number {
    return this.ids[this.indexOf(x, y)] ?? 0;
  }

  tileAt(x: number, y: number): Tile {
    const index = this.indexOf(x, y);
    return {
      kind: this.kinds[index] as TileKind,
      id: this.ids[index] ?? 0,
    };
  }

  place(x: number, y: number, kind: TileKind): number {
    const index = this.indexOf(x, y);
    if (kind === TileKind.Empty) {
      this.clearIndex(index);
      return 0;
    }

    if (this.kinds[index] === kind) {
      return this.ids[index] ?? 0;
    }

    const id = this.nextTileId;
    this.nextTileId += 1;
    this.kinds[index] = kind;
    this.ids[index] = id;
    return id;
  }

  clear(): void {
    this.kinds.fill(TileKind.Empty);
    this.ids.fill(0);
  }

  clone(): World {
    const copy = new World(this.width, this.height);
    copy.copyFrom(this);
    return copy;
  }

  copyFrom(source: World): void {
    if (source.width !== this.width || source.height !== this.height) {
      throw new RangeError("Cannot copy worlds with different dimensions");
    }

    this.kinds.set(source.kinds);
    this.ids.set(source.ids);
    this.nextTileId = source.nextTileId;
  }

  kindAtIndex(index: number): TileKind {
    this.assertIndex(index);
    return this.kinds[index] as TileKind;
  }

  moveIndex(from: number, to: number): void {
    this.assertIndex(from);
    this.assertIndex(to);
    if (this.kinds[from] === TileKind.Empty || this.kinds[to] !== TileKind.Empty) {
      throw new Error("A move requires an occupied source and empty destination");
    }

    this.kinds[to] = this.kinds[from] ?? TileKind.Empty;
    this.ids[to] = this.ids[from] ?? 0;
    this.clearIndex(from);
  }

  private indexOf(x: number, y: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new RangeError(`Cell (${x}, ${y}) is outside the world`);
    }
    return y * this.width + x;
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.cellCount) {
      throw new RangeError(`Cell index ${index} is outside the world`);
    }
  }

  private clearIndex(index: number): void {
    this.kinds[index] = TileKind.Empty;
    this.ids[index] = 0;
  }
}
