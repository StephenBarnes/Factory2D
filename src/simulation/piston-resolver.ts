import { expectDefined } from "../util/assert";
import { recordShatterAnimation } from "./shatter-animation";
import { Direction, directionX, directionY, oppositeDirection, TILE_DEFINITIONS, TileKind } from "./tile";
import { World } from "./world";
import { WorldFeature } from "./world-features";

interface Stroke {
  base: number;
  arm: number;
  action: -1 | 1;
  direction: Direction;
  recoil: boolean;
  headWelded: boolean;
  valid: boolean;
  ready: boolean;
  parent: number;
  jammed: boolean;
  cells: number[];
  partners: number[];
}

/** One-cell strokes in dependency-ordered rounds; circuits and gravity are not substepped. */
export class PistonResolver {
  private readonly strokes: Stroke[] = [];
  private strokeCount = 0;
  private readonly strokeAt: Int32Array;
  private readonly visited: Uint32Array;
  private visit = 0;
  private readonly sweepOwners: Int32Array;
  private readonly destinationOwners: Int32Array;
  private readonly destinationSources: Int32Array;
  private readonly cellRoots: Int32Array;
  private readonly moveX: Int16Array;
  private readonly moveY: Int16Array;
  private readonly actions: Int8Array;
  private readonly headWelds: Uint8Array;
  private readonly armIds: Uint32Array;
  private readonly breakingFasteners: number[] = [];

  constructor(private readonly world: World) {
    this.strokeAt = new Int32Array(world.cellCount);
    this.visited = new Uint32Array(world.cellCount);
    this.sweepOwners = new Int32Array(world.cellCount);
    this.destinationOwners = new Int32Array(world.cellCount);
    this.destinationSources = new Int32Array(world.cellCount);
    this.cellRoots = Int32Array.from({ length: world.cellCount }, (_, cell) => cell);
    this.moveX = new Int16Array(world.cellCount);
    this.moveY = new Int16Array(world.cellCount);
    this.actions = new Int8Array(world.cellCount);
    this.headWelds = new Uint8Array(world.cellCount);
    this.armIds = new Uint32Array(world.cellCount);
  }

  resolve(): number {
    let movementCount = 0;
    for (;;) {
      this.collectStrokes();
      if (this.strokeCount === 0) {
        return movementCount;
      }
      this.chooseReadyStrokes();
      this.resolveConflicts();
      const progress = this.commit();
      if (progress === 0) {
        return movementCount;
      }
      movementCount += progress;
      // A successful stroke changes P/+ to base/+ or base/- to P/-.
      // Charges do not advance here, so that piston cannot stroke twice.
    }
  }

  private collectStrokes(): void {
    this.strokeAt.fill(-1);
    this.strokeCount = 0;
    for (
      let base = this.world.firstFeatureIndex(WorldFeature.Piston);
      base >= 0;
      base = this.world.nextFeatureIndex(WorldFeature.Piston, base)
    ) {
      const kind = this.world.kindAtIndex(base);
      const charge = this.world.chargeAtPortIndex(base, Direction.Up);
      const action = kind === TileKind.Piston && charge === 1 ? 1
        : kind === TileKind.PistonBase && charge === -1 ? -1 : 0;
      if (action === 0) {
        continue;
      }
      const direction = this.world.orientationAtIndex(base);
      const arm = this.neighbor(base, direction);
      if (action === -1 && (arm < 0 || this.world.kindAtIndex(arm) !== TileKind.PistonArm ||
          this.world.orientationAtIndex(arm) !== direction || !this.world.hasWeldAtIndex(base, direction))) {
        continue;
      }
      const index = this.strokeCount++;
      let stroke = this.strokes[index];
      if (stroke === undefined) {
        stroke = { base, arm, action, direction, recoil: false, headWelded: false,
          valid: false, ready: false, parent: index, jammed: false, cells: [], partners: [] };
        this.strokes.push(stroke);
      }
      stroke.base = base;
      stroke.arm = arm;
      stroke.action = action;
      stroke.direction = action === 1 ? direction : oppositeDirection(direction);
      stroke.recoil = false;
      stroke.headWelded = this.world.hasWeldAtIndex(action === 1 ? base : arm, direction);
      stroke.parent = index;
      stroke.jammed = false;
      stroke.ready = false;
      this.strokeAt[base] = index;
    }
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "observed piston stroke");
      stroke.valid = this.propose(stroke);
    }
    // A shared welded beam may require several matching head strokes. Reject
    // the entire bundle if any required actuator cannot complete its stroke.
    let changed: boolean;
    do {
      changed = false;
      for (let index = 0; index < this.strokeCount; index += 1) {
        const stroke = expectDefined(this.strokes[index], "cooperating piston stroke");
        if (!stroke.valid) {
          continue;
        }
        for (const partner of stroke.partners) {
          if (!expectDefined(this.strokes[partner], "required piston stroke").valid) {
            stroke.valid = false;
            changed = true;
            break;
          }
        }
      }
    } while (changed);
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "recoiling piston stroke");
      if (!stroke.valid && stroke.action === 1) {
        stroke.recoil = true;
        stroke.direction = oppositeDirection(stroke.direction);
        stroke.valid = this.propose(stroke);
      }
    }
  }

  /** Carried pistons stay rigid; matching actuators on a shared load cooperate. */
  private propose(stroke: Stroke): boolean {
    stroke.cells.length = 0;
    stroke.partners.length = 0;
    this.visit = (this.visit + 1) >>> 0;
    if (this.visit === 0) {
      this.visited.fill(0);
      this.visit = 1;
    }
    const { base, arm, action, recoil, direction } = stroke;
    if (action === 1 && !recoil && arm < 0) {
      return false;
    }
    const head = arm < 0 ? -1 : this.neighbor(arm, this.world.orientationAtIndex(base));
    const seed = recoil ? base : action === 1 ? arm : stroke.headWelded ? head : -1;
    if (seed >= 0 && this.world.kindAtIndex(seed) !== TileKind.Empty) {
      this.enqueue(stroke, seed);
    }
    // Pulls collect only weld closure. Pushes additionally collect contact chains.
    for (let cursor = 0; cursor < stroke.cells.length; cursor += 1) {
      const cell = expectDefined(stroke.cells[cursor], "piston proposal cell");
      const definition = TILE_DEFINITIONS[this.world.kindAtIndex(cell)];
      if (definition.immovable ||
          (definition.slidesAlongOrientation &&
            (this.world.orientationAtIndex(cell) & 1) !== (direction & 1)) ||
          (!recoil && cell === base) || (recoil && cell === arm)) {
        return false;
      }
      for (let side: Direction = Direction.Up; side <= Direction.Left; side += 1) {
        if (!this.world.hasWeldAtIndex(cell, side)) {
          continue;
        }
        const other = this.neighbor(cell, side);
        if (other < 0) {
          throw new Error(`Piston proposal found an out-of-bounds weld at ${cell}`);
        }
        if (action === -1 ? other === arm :
            (cell === base && other === arm || cell === arm && other === base)) {
          continue;
        }
        const partner = this.partnerAt(stroke, cell, other);
        if (partner >= 0 && this.visited[other] !== this.visit) {
          stroke.partners.push(partner);
          continue;
        }
        this.enqueue(stroke, other);
      }
      const destination = this.neighbor(cell, direction);
      if (destination < 0) {
        return false;
      }
      if (action === 1 && this.world.kindAtIndex(destination) !== TileKind.Empty) {
        this.enqueue(stroke, destination);
      }
    }
    if (action === -1) {
      for (const cell of stroke.cells) {
        const destination = this.neighbor(cell, direction);
        if (destination !== arm && this.world.kindAtIndex(destination) !== TileKind.Empty &&
            this.visited[destination] !== this.visit && this.partnerAt(stroke, cell, destination) < 0) {
          return false;
        }
      }
    }
    return true;
  }

  /** Only split an aligned actuator approached from its welded load, not its base. */
  private partnerAt(stroke: Stroke, head: number, connection: number): number {
    if (stroke.recoil) {
      return -1;
    }
    const orientation = this.world.orientationAtIndex(stroke.base);
    if (this.neighbor(connection, orientation) !== head ||
        !this.world.hasWeldAtIndex(connection, orientation)) {
      return -1;
    }
    const base = stroke.action === 1 ? connection
      : this.world.kindAtIndex(connection) === TileKind.PistonArm
        ? this.neighbor(connection, oppositeDirection(orientation)) : -1;
    const index = base < 0 ? -1 : expectDefined(this.strokeAt[base], "cooperating piston index");
    if (index < 0 || base === stroke.base) {
      return -1;
    }
    const partner = expectDefined(this.strokes[index], "cooperating piston");
    return partner.action === stroke.action && this.world.orientationAtIndex(base) === orientation
      ? index : -1;
  }

  private enqueue(stroke: Stroke, cell: number): void {
    if (this.visited[cell] !== this.visit) {
      this.visited[cell] = this.visit;
      stroke.cells.push(cell);
    }
  }

  private chooseReadyStrokes(): void {
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "piston stroke");
      stroke.ready = stroke.valid;
      if (!stroke.valid) {
        continue;
      }
      for (const cell of stroke.cells) {
        const carried = expectDefined(this.strokeAt[cell], "carried piston stroke");
        if (carried >= 0 && carried !== index &&
            expectDefined(this.strokes[carried], "carried piston proposal").valid) {
          stroke.ready = false;
          break;
        }
      }
    }
    // Shared-load bundles must be ready together; propagate deferral across
    // the bundle before any acceptance or collision claim is made.
    let changed: boolean;
    do {
      changed = false;
      for (let index = 0; index < this.strokeCount; index += 1) {
        const stroke = expectDefined(this.strokes[index], "piston bundle readiness");
        if (!stroke.ready) {
          continue;
        }
        for (const partner of stroke.partners) {
          if (!expectDefined(this.strokes[partner], "partner readiness").ready) {
            stroke.ready = false;
            changed = true;
            break;
          }
        }
      }
    } while (changed);
    // No ready node in a dependency cycle: conservatively leave that mechanism still.
    // A blocked carried piston is rigid cargo, not a dependency that must succeed.
  }

  private resolveConflicts(): void {
    this.sweepOwners.fill(-1);
    this.destinationOwners.fill(-1);
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "piston conflict proposal");
      if (!stroke.ready) {
        continue;
      }
      for (const partner of stroke.partners) {
        this.join(index, partner, false);
      }
      // Record every member even after a conflict, so no scan order hides rivals.
      for (const cell of stroke.cells) {
        const destination = this.neighbor(cell, stroke.direction);
        this.claimSweep(cell, index);
        this.claimSweep(destination, index);
        this.claimDestination(destination, cell, index);
      }
      if (stroke.action === 1) {
        this.claimDestination(stroke.recoil ? stroke.base : stroke.arm, -index - 1, index);
      }
    }
  }

  private claimSweep(cell: number, index: number): void {
    const previous = expectDefined(this.sweepOwners[cell], "piston sweep owner");
    if (previous < 0) {
      this.sweepOwners[cell] = index;
    } else if (previous !== index) {
      this.join(previous, index,
        expectDefined(this.strokes[previous], "previous piston sweep").direction !==
        expectDefined(this.strokes[index], "current piston sweep").direction);
    }
  }

  private claimDestination(cell: number, source: number, index: number): void {
    const previous = expectDefined(this.destinationOwners[cell], "piston destination owner");
    if (previous < 0) {
      this.destinationOwners[cell] = index;
      this.destinationSources[cell] = source;
    } else {
      this.join(previous, index, this.destinationSources[cell] !== source);
    }
  }

  private group(index: number): Stroke {
    let stroke = expectDefined(this.strokes[index], "piston acceptance group");
    while (stroke.parent !== index) {
      const parent = expectDefined(this.strokes[stroke.parent], "piston group parent");
      stroke.parent = parent.parent;
      index = stroke.parent;
      stroke = expectDefined(this.strokes[index], "piston group root");
    }
    return stroke;
  }

  private join(first: number, second: number, conflict: boolean): void {
    const a = this.group(first);
    const b = this.group(second);
    const jammed = a.jammed || b.jammed || conflict;
    if (a.parent < b.parent) {
      b.parent = a.parent;
      a.jammed = jammed;
    } else {
      a.parent = b.parent;
      b.jammed = jammed;
    }
  }

  private commit(): number {
    this.moveX.fill(0);
    this.moveY.fill(0);
    this.actions.fill(0);
    this.headWelds.fill(0);
    this.armIds.fill(0);
    let accepted = 0;
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "committing piston proposal");
      if (!stroke.ready || this.group(index).jammed) {
        continue;
      }
      accepted += 1;
      for (const cell of stroke.cells) {
        this.moveX[cell] = directionX(stroke.direction);
        this.moveY[cell] = directionY(stroke.direction);
      }
      const base = stroke.recoil ? this.neighbor(stroke.base, stroke.direction) : stroke.base;
      this.actions[base] = stroke.action;
      this.headWelds[base] = stroke.headWelded ? 1 : 0;
      if (stroke.action === -1) {
        this.armIds[base] = this.world.idAtIndex(stroke.arm);
      }
    }
    if (accepted === 0) {
      return 0;
    }
    // Weld storage belongs to the upper/left cell. Remove accepted seams before
    // copying cells, then let the transition restore them at their new locations.
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "piston seam proposal");
      if (!stroke.ready || this.group(index).jammed || stroke.arm < 0) {
        continue;
      }
      this.clearWeld(stroke.base, stroke.arm);
      if (stroke.action === -1 && stroke.headWelded) {
        this.clearWeld(stroke.arm, this.neighbor(stroke.arm, this.world.orientationAtIndex(stroke.base)));
      }
    }
    this.breakingFasteners.length = 0;
    for (let cell = this.world.firstFeatureIndex(WorldFeature.Fastener); cell >= 0;
      cell = this.world.nextFeatureIndex(WorldFeature.Fastener, cell)) {
      const dx = expectDefined(this.moveX[cell], "fastener piston horizontal move");
      const dy = expectDefined(this.moveY[cell], "fastener piston vertical move");
      if (dx !== 0 || dy !== 0) {
        this.breakingFasteners.push(cell + dx + dy * this.world.width);
      }
    }
    const movements = this.world.moveBodies(this.cellRoots, this.moveX, this.moveY);
    const transitions = this.world.applyPistonTransitions(this.actions, this.headWelds, this.armIds);
    for (const cell of this.breakingFasteners) {
      if (this.world.kindAtIndex(cell) !== TileKind.Fastener) {
        throw new Error(`Moved fastener missing at index ${cell}`);
      }
      recordShatterAnimation(this.world, cell);
      this.world.place(cell % this.world.width, Math.floor(cell / this.world.width), TileKind.Empty);
    }
    return movements + transitions;
  }

  private clearWeld(first: number, second: number): void {
    this.world.setWeld(first % this.world.width, Math.floor(first / this.world.width),
      second % this.world.width, Math.floor(second / this.world.width), false);
  }

  private neighbor(cell: number, direction: Direction): number {
    const x = cell % this.world.width;
    switch (direction) {
      case Direction.Up: return cell >= this.world.width ? cell - this.world.width : -1;
      case Direction.Right: return x + 1 < this.world.width ? cell + 1 : -1;
      case Direction.Down: return cell + this.world.width < this.world.cellCount ? cell + this.world.width : -1;
      case Direction.Left: return x > 0 ? cell - 1 : -1;
    }
  }
}
