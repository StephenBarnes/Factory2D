import { expectDefined } from "../util/assert";
import { ASSEMBLER_PATTERNS, MIRRORED_ASSEMBLER_PATTERNS, type AssemblerPattern } from "./assembler";
import { MAX_ASSEMBLER_OUTPUTS } from "./configurable-components";
import type { DeliveryResolver } from "./delivery-resolver";
import type { DuplicatorResolver } from "./duplicator-resolver";
import { recordMachineryActivity } from "./machinery-activity";
import {
  Direction,
  orientedDirection,
  oppositeDirection,
  TILE_DEFINITIONS,
  TileKind,
} from "./tile";
import type { World } from "./world";
import { WeldedBodyIndex } from "./welded-body-index";
import { WorldFeature } from "./world-features";

/**
 * Collects assembler intents from the stable start-of-tick topology and commits them after
 * deliveries. An assembler with pending outputs only tries to emit its next output into
 * the empty cell behind it; an idle assembler consumes the whole welded body ahead of it
 * when that body matches any recipe rotation. Two assemblers claiming the same body or
 * the same output cell jam. A body that another phase changed before this commit, or an
 * output cell that a duplicator filled, is skipped for this tick. Scratch buffers are
 * retained across ticks.
 */
export class AssemblerResolver {
  private readonly world: World;
  private readonly bodies: WeldedBodyIndex;
  private readonly consumeTargetIndices: Int32Array;
  private readonly bodyOwners: Int32Array;
  private readonly observedIds: Uint32Array;
  private readonly observedKinds: Uint8Array;
  private readonly queuedCounts: Uint8Array;
  private readonly queuedKinds: Uint8Array;
  private readonly queuedOrientations: Uint8Array;
  private readonly queuedMirrored: Uint8Array;
  private readonly emitTargetIndices: Int32Array;
  private readonly emitOwners: Int32Array;
  private intentCount = 0;

  constructor(world: World, bodies: WeldedBodyIndex) {
    this.world = world;
    this.bodies = bodies;
    this.consumeTargetIndices = new Int32Array(world.cellCount);
    this.bodyOwners = new Int32Array(world.cellCount);
    this.observedIds = new Uint32Array(world.cellCount);
    this.observedKinds = new Uint8Array(world.cellCount);
    this.queuedCounts = new Uint8Array(world.cellCount);
    this.queuedKinds = new Uint8Array(world.cellCount * MAX_ASSEMBLER_OUTPUTS);
    this.queuedOrientations = new Uint8Array(world.cellCount * MAX_ASSEMBLER_OUTPUTS);
    this.queuedMirrored = new Uint8Array(world.cellCount * MAX_ASSEMBLER_OUTPUTS);
    this.emitTargetIndices = new Int32Array(world.cellCount);
    this.emitOwners = new Int32Array(world.cellCount);
  }

  collect(duplications: DuplicatorResolver | null, deliveries: DeliveryResolver | null): void {
    this.consumeTargetIndices.fill(-1);
    this.bodyOwners.fill(-1);
    this.queuedCounts.fill(0);
    this.emitTargetIndices.fill(-1);
    this.emitOwners.fill(-1);
    this.intentCount = 0;

    for (
      let assembler = this.world.firstFeatureIndex(WorldFeature.Assembler);
      assembler >= 0;
      assembler = this.world.nextFeatureIndex(WorldFeature.Assembler, assembler)
    ) {
      const orientation = this.world.orientationAtIndex(assembler);
      const mirrored = this.world.mirroredAtIndex(assembler);
      const left = orientedDirection(Direction.Left, orientation, mirrored);
      if (this.world.chargeAtPortIndex(assembler, left) === -1 ||
          deliveries?.willAbsorb(assembler)) {
        continue;
      }
      if (this.world.assemblerPendingCountAtIndex(assembler) > 0) {
        const output = this.neighborIndex(assembler, oppositeDirection(orientation));
        // Production pulses resolve before commits, so exclude earlier-phase claims now.
        if (output < 0 || this.world.kindAtIndex(output) !== TileKind.Empty ||
            duplications?.willFill(output)) {
          continue;
        }
        this.emitTargetIndices[assembler] = output;
        const owner = expectDefined(this.emitOwners[output], "assembler output owner");
        this.emitOwners[output] = owner === -1 ? assembler : -2;
        this.intentCount += 1;
        continue;
      }

      const input = this.neighborIndex(assembler, orientation);
      if (input < 0 || this.world.kindAtIndex(input) === TileKind.Empty) {
        continue;
      }
      const root = this.bodies.rootAt(input);
      if (root === this.bodies.rootAt(assembler)) {
        continue;
      }
      const pattern = this.matchingPattern(root, mirrored);
      if (pattern === null) {
        continue;
      }
      this.consumeTargetIndices[assembler] = input;
      const base = assembler * MAX_ASSEMBLER_OUTPUTS;
      this.queuedCounts[assembler] = pattern.outputs.length;
      for (let slot = 0; slot < pattern.outputs.length; slot += 1) {
        const output = expectDefined(pattern.outputs[slot], "assembler recipe output");
        this.queuedKinds[base + slot] = output.kind;
        this.queuedOrientations[base + slot] = output.orientation;
        this.queuedMirrored[base + slot] = output.mirrored ? 1 : 0;
      }
      let member = this.bodies.headAtRoot(root);
      while (member >= 0) {
        const owner = expectDefined(this.bodyOwners[member], "assembler body owner");
        this.bodyOwners[member] = owner === -1 ? assembler : -2;
        this.observedIds[member] = this.world.idAtIndex(member);
        this.observedKinds[member] = this.world.kindAtIndex(member);
        member = this.bodies.nextMember(member);
      }
      this.intentCount += 1;
    }

    if (this.intentCount === 0) {
      return;
    }
    for (
      let assembler = this.world.firstFeatureIndex(WorldFeature.Assembler);
      assembler >= 0;
      assembler = this.world.nextFeatureIndex(WorldFeature.Assembler, assembler)
    ) {
      const output = expectDefined(this.emitTargetIndices[assembler], "assembler emit target");
      if (output >= 0 && this.emitOwners[output] !== assembler) {
        this.emitTargetIndices[assembler] = -1;
      }
      const input = expectDefined(this.consumeTargetIndices[assembler], "assembler consume target");
      if (input >= 0 && this.bodyOwners[input] !== assembler) {
        this.consumeTargetIndices[assembler] = -1;
        this.queuedCounts[assembler] = 0;
      }
    }
  }

  /** Resolved production intent used by the same-tick isolated circuit output. */
  willEmit(index: number): boolean {
    return expectDefined(this.emitTargetIndices[index], "assembler emit target") >= 0;
  }

  /**
   * Drops intents invalidated by earlier phases this tick, then applies the rest to the
   * world and, identically, to the interpolation source so emitted tiles animate from
   * their output cell.
   */
  commit(interpolationSource?: World): void {
    if (this.intentCount === 0) {
      return;
    }
    let remaining = 0;
    for (
      let assembler = this.world.firstFeatureIndex(WorldFeature.Assembler);
      assembler >= 0;
      assembler = this.world.nextFeatureIndex(WorldFeature.Assembler, assembler)
    ) {
      const output = expectDefined(this.emitTargetIndices[assembler], "assembler emit target");
      if (output >= 0) {
        if (this.world.kindAtIndex(output) !== TileKind.Empty) {
          this.emitTargetIndices[assembler] = -1;
        } else {
          remaining += 1;
        }
      }
      const input = expectDefined(this.consumeTargetIndices[assembler], "assembler consume target");
      if (input < 0) {
        continue;
      }
      if (this.bodyUnchanged(assembler)) {
        remaining += 1;
        continue;
      }
      this.consumeTargetIndices[assembler] = -1;
      this.queuedCounts[assembler] = 0;
      const root = this.bodies.rootAt(input);
      let member = this.bodies.headAtRoot(root);
      while (member >= 0) {
        if (this.bodyOwners[member] === assembler) {
          this.bodyOwners[member] = -1;
        }
        member = this.bodies.nextMember(member);
      }
    }
    if (remaining === 0) {
      return;
    }
    this.world.applyAssemblerResults(
      this.consumeTargetIndices,
      this.bodyOwners,
      this.queuedCounts,
      this.queuedKinds,
      this.queuedOrientations,
      this.queuedMirrored,
      this.emitTargetIndices,
    );
    recordMachineryActivity(this.world, "assembler");
    interpolationSource?.applyAssemblerResults(
      this.consumeTargetIndices,
      this.bodyOwners,
      this.queuedCounts,
      this.queuedKinds,
      this.queuedOrientations,
      this.queuedMirrored,
      this.emitTargetIndices,
    );
  }

  private bodyUnchanged(assembler: number): boolean {
    const input = expectDefined(
      this.consumeTargetIndices[assembler],
      "assembler unchanged-body input",
    );
    const root = this.bodies.rootAt(input);
    let member = this.bodies.headAtRoot(root);
    while (member >= 0) {
      if (
        this.world.idAtIndex(member) !== this.observedIds[member] ||
        this.world.kindAtIndex(member) !== this.observedKinds[member]
      ) {
        return false;
      }
      member = this.bodies.nextMember(member);
    }
    return true;
  }

  private matchingPattern(root: number, mirrored: boolean): AssemblerPattern | null {
    const count = this.bodies.memberCountAtRoot(root);
    const minX = this.bodies.minXAtRoot(root);
    const minY = this.bodies.minYAtRoot(root);
    for (const pattern of mirrored ? MIRRORED_ASSEMBLER_PATTERNS : ASSEMBLER_PATTERNS) {
      if (pattern.cells.length === count && this.matchesPattern(root, minX, minY, pattern)) {
        return pattern;
      }
    }
    return null;
  }

  private matchesPattern(
    root: number,
    minX: number,
    minY: number,
    pattern: AssemblerPattern,
  ): boolean {
    for (const cell of pattern.cells) {
      const x = minX + cell.dx;
      const y = minY + cell.dy;
      if (x >= this.world.width || y >= this.world.height) {
        return false;
      }
      const index = y * this.world.width + x;
      const kind = this.world.kindAtIndex(index);
      if (
        kind !== cell.kind ||
        this.bodies.rootAt(index) !== root ||
        (TILE_DEFINITIONS[kind].usesOrientation &&
          this.world.orientationAtIndex(index) !== cell.orientation) ||
        this.world.mirroredAtIndex(index) !== cell.mirrored ||
        this.world.hasRightWeldAtIndex(index) !== cell.rightWeld ||
        this.world.hasDownWeldAtIndex(index) !== cell.downWeld
      ) {
        return false;
      }
    }
    return true;
  }

  private neighborIndex(index: number, direction: Direction): number {
    const x = index % this.world.width;
    switch (direction) {
      case Direction.Up:
        return index >= this.world.width ? index - this.world.width : -1;
      case Direction.Right:
        return x < this.world.width - 1 ? index + 1 : -1;
      case Direction.Down:
        return index < this.world.cellCount - this.world.width
          ? index + this.world.width
          : -1;
      case Direction.Left:
        return x > 0 ? index - 1 : -1;
      default:
        throw new RangeError(`Invalid direction ${direction as number}`);
    }
  }
}
