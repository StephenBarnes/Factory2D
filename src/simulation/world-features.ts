import { isProcessingMachine } from "./furnace";
import { expectDefined } from "../util/assert";
import {
  TILE_DEFINITIONS,
  TILE_KINDS,
  TileKind,
  WeldSide,
} from "./tile";

/** Stable row-major index categories used to avoid irrelevant whole-board simulation passes. */
export const enum WorldFeature {
  Occupied = 0,
  Circuit = 1,
  CircuitSource = 2,
  CircuitGate = 3,
  Piston = 4,
  Delivery = 5,
  Duplicator = 6,
  Assembler = 7,
  WeldOperator = 8,
  Furnace = 9,
  Gravity = 10,
  Magnet = 11,
  Conveyor = 12,
  RuneArray = 13,
  Rotator = 14,
  WeldedBodyObserver = 15,
  Drill = 16,
  Fastener = 17,
  Fragile = 18,
  Thruster = 19,
  MovementSensor = 20,
  LevitationProjector = 21,
  MagicLink = 22,
  Count = 23,
}

const FEATURE_MASKS = new Uint32Array(
  TILE_KINDS.reduce((maximum, kind) => Math.max(maximum, kind), TileKind.Empty) + 1,
);
for (const kind of TILE_KINDS) {
  const definition = TILE_DEFINITIONS[kind];
  let mask = kind === TileKind.Empty ? 0 : 1 << WorldFeature.Occupied;
  if (
    definition.circuitPorts !== WeldSide.None ||
    definition.circuitInputPorts !== WeldSide.None ||
    definition.circuitOutputPorts !== WeldSide.None
  ) {
    mask |= 1 << WorldFeature.Circuit;
  }
  if (
    kind === TileKind.FixedCharge ||
    kind === TileKind.Spark ||
    kind === TileKind.Sensor ||
    kind === TileKind.MovementSensor ||
    kind === TileKind.Delivery ||
    kind === TileKind.Comparer ||
    kind === TileKind.BlockComparer ||
    kind === TileKind.Assembler ||
    kind === TileKind.Welder ||
    kind === TileKind.Splitter ||
    kind === TileKind.LaserSplitter ||
    kind === TileKind.Dismantler ||
    isProcessingMachine(kind)
  ) {
    mask |= 1 << WorldFeature.CircuitSource;
  }
  if (definition.circuitInputPorts !== WeldSide.None) {
    mask |= 1 << WorldFeature.CircuitGate;
  }
  if (kind === TileKind.Piston || kind === TileKind.PistonBase) {
    mask |= 1 << WorldFeature.Piston;
  }
  if (kind === TileKind.Delivery) {
    mask |= 1 << WorldFeature.Delivery | 1 << WorldFeature.WeldedBodyObserver;
  }
  if (kind === TileKind.Comparer) {
    mask |= 1 << WorldFeature.WeldedBodyObserver;
  }
  if (kind === TileKind.Duplicator) {
    mask |= 1 << WorldFeature.Duplicator | 1 << WorldFeature.WeldedBodyObserver;
  }
  if (kind === TileKind.Assembler) {
    mask |= 1 << WorldFeature.Assembler | 1 << WorldFeature.WeldedBodyObserver;
  }
  if (kind === TileKind.Welder || kind === TileKind.Splitter ||
      kind === TileKind.LaserSplitter || kind === TileKind.Dismantler) {
    mask |= 1 << WorldFeature.WeldOperator;
  }
  if (kind === TileKind.Furnace || kind === TileKind.Grinder) {
    mask |= 1 << WorldFeature.Furnace;
  }
  if (kind === TileKind.Drill) {
    mask |= 1 << WorldFeature.Drill;
  }
  if (kind === TileKind.Fastener) {
    mask |= 1 << WorldFeature.Fastener;
  }
  if (definition.fragile === true) {
    mask |= 1 << WorldFeature.Fragile;
  }
  if (definition.affectedByGravity) {
    mask |= 1 << WorldFeature.Gravity;
  }
  if (definition.attractionRange > 0) {
    mask |= 1 << WorldFeature.Magnet;
  }
  if (kind === TileKind.Conveyor) {
    mask |= 1 << WorldFeature.Conveyor;
  }
  if (kind === TileKind.Thruster || kind === TileKind.ControlledThruster) {
    mask |= 1 << WorldFeature.Thruster;
  }
  if (kind === TileKind.LevitationProjector) {
    mask |= 1 << WorldFeature.LevitationProjector;
  }
  if (kind === TileKind.MagicLink) {
    mask |= 1 << WorldFeature.MagicLink;
  }
  if (kind === TileKind.RuneArray) {
    mask |= 1 << WorldFeature.RuneArray;
  }
  if (kind === TileKind.MovementSensor) {
    mask |= 1 << WorldFeature.MovementSensor;
  }
  if (kind === TileKind.Rotator) {
    mask |= 1 << WorldFeature.Rotator | 1 << WorldFeature.WeldedBodyObserver;
  }
  FEATURE_MASKS[kind] = mask;
}

/**
 * Bitsets retain row-major ordering while allowing constant-time feature-presence checks.
 * Every tile-kind mutation must flow through this index's replace/rebuild operations.
 */
export class WorldFeatureIndex {
  private readonly cellCount: number;
  private readonly wordCount: number;
  private readonly bits: Uint32Array;
  private readonly counts = new Uint32Array(WorldFeature.Count);

  constructor(cellCount: number) {
    this.cellCount = cellCount;
    this.wordCount = Math.ceil(cellCount / 32);
    this.bits = new Uint32Array(this.wordCount * WorldFeature.Count);
  }

  has(feature: WorldFeature): boolean {
    this.assertFeature(feature);
    return expectDefined(this.counts[feature], "world feature count") !== 0;
  }

  replace(index: number, oldKind: TileKind, newKind: TileKind): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.cellCount) {
      throw new RangeError(`Invalid world feature index ${index}`);
    }
    const oldMask = expectDefined(FEATURE_MASKS[oldKind], "old tile feature mask");
    const newMask = expectDefined(FEATURE_MASKS[newKind], "new tile feature mask");
    const changed = oldMask ^ newMask;
    if (changed === 0) {
      return;
    }
    const word = index >>> 5;
    const bit = 1 << (index & 31);
    for (let feature = 0; feature < WorldFeature.Count; feature += 1) {
      const featureBit = 1 << feature;
      if ((changed & featureBit) === 0) {
        continue;
      }
      const offset = feature * this.wordCount + word;
      const previousWord = expectDefined(this.bits[offset], "world feature word");
      const previousCount = expectDefined(this.counts[feature], "world feature count");
      if ((newMask & featureBit) !== 0) {
        if ((previousWord & bit) !== 0) {
          throw new Error(`World feature ${feature} already contains index ${index}`);
        }
        this.bits[offset] = previousWord | bit;
        this.counts[feature] = previousCount + 1;
      } else {
        if ((previousWord & bit) === 0 || previousCount === 0) {
          throw new Error(`World feature ${feature} does not contain index ${index}`);
        }
        this.bits[offset] = previousWord & ~bit;
        this.counts[feature] = previousCount - 1;
      }
    }
  }

  clear(): void {
    this.bits.fill(0);
    this.counts.fill(0);
  }

  copyFrom(source: WorldFeatureIndex): void {
    if (source.cellCount !== this.cellCount) {
      throw new RangeError("Cannot copy world features between different cell counts");
    }
    this.bits.set(source.bits);
    this.counts.set(source.counts);
  }

  rebuild(kinds: Uint8Array): void {
    if (kinds.length !== this.cellCount) {
      throw new RangeError("World feature source must match the world cell count");
    }
    this.clear();
    for (let index = 0; index < kinds.length; index += 1) {
      const kind = kinds[index] as TileKind;
      if (kind !== TileKind.Empty) {
        this.replace(index, TileKind.Empty, kind);
      }
    }
  }

  first(feature: WorldFeature): number {
    return this.next(feature, -1);
  }

  next(feature: WorldFeature, after: number): number {
    this.assertFeature(feature);
    if (!Number.isInteger(after) || after < -1 || after >= this.cellCount) {
      throw new RangeError(`Invalid feature-index cursor ${after}`);
    }
    let index = after + 1;
    if (index >= this.cellCount) {
      return -1;
    }
    let word = index >>> 5;
    const base = feature * this.wordCount;
    let candidates = expectDefined(this.bits[base + word], "world feature word") &
      (-1 << (index & 31));
    while (true) {
      if (candidates !== 0) {
        const result = (word << 5) + 31 - Math.clz32(candidates & -candidates);
        return result < this.cellCount ? result : -1;
      }
      word += 1;
      if (word >= this.wordCount) {
        return -1;
      }
      candidates = expectDefined(this.bits[base + word], "world feature word");
    }
  }

  last(feature: WorldFeature): number {
    return this.previous(feature, this.cellCount);
  }

  previous(feature: WorldFeature, before: number): number {
    this.assertFeature(feature);
    if (!Number.isInteger(before) || before <= 0 || before > this.cellCount) {
      if (before === 0) {
        return -1;
      }
      throw new RangeError(`Invalid feature-index cursor ${before}`);
    }
    const index = before - 1;
    let word = index >>> 5;
    const base = feature * this.wordCount;
    const keptBits = (index & 31) === 31 ? -1 : (1 << ((index & 31) + 1)) - 1;
    let candidates = expectDefined(this.bits[base + word], "world feature word") & keptBits;
    while (true) {
      if (candidates !== 0) {
        return (word << 5) + 31 - Math.clz32(candidates);
      }
      if (word === 0) {
        return -1;
      }
      word -= 1;
      candidates = expectDefined(this.bits[base + word], "world feature word");
    }
  }

  private assertFeature(feature: WorldFeature): void {
    if (!Number.isInteger(feature) || feature < 0 || feature >= WorldFeature.Count) {
      throw new RangeError(`Invalid world feature ${feature as number}`);
    }
  }
}
