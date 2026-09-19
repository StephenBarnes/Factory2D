import { expectDefined } from "../util/assert";
import { magicLinksFor } from "./magic-link";
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
  dependencies: number[];
  dependencyIndex: number;
  dependencyLow: number;
  dependencyComponent: number;
  dependencyCursor: number;
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
  private readonly retractingBases: Uint8Array;
  private readonly breakingFasteners: number[] = [];
  private readonly dependencyPath: number[] = [];
  private readonly dependencyStack: number[] = [];

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
    this.retractingBases = new Uint8Array(world.cellCount);
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
      let progress = this.commit();
      if (progress === 0) {
        // Only break carrying cycles after the ordinary dependency rounds stall.
        this.chooseReadyStrokes(true);
        this.resolveConflicts();
        progress = this.commit();
      }
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
          valid: false, ready: false, parent: index, jammed: false, cells: [], partners: [],
          dependencies: [], dependencyIndex: -1, dependencyLow: -1,
          dependencyComponent: -1, dependencyCursor: 0 };
        this.strokes.push(stroke);
      }
      stroke.base = base;
      stroke.arm = arm;
      stroke.action = action;
      stroke.recoil = action === -1 && direction === Direction.Down;
      stroke.direction = action === 1 || stroke.recoil ? direction : oppositeDirection(direction);
      stroke.headWelded = this.world.hasWeldAtIndex(action === 1 ? base : arm, direction);
      stroke.ready = false;
      this.strokeAt[base] = index;
    }
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "observed piston stroke");
      stroke.valid = this.propose(stroke);
    }
    this.rejectInvalidPartners();
    // Retraction prefers downward motion: lower a downward-facing base onto
    // its arm, falling back to lifting the head if the base cannot move.
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "lowering piston stroke");
      if (!stroke.valid && stroke.action === -1 && stroke.recoil) {
        stroke.recoil = false;
        stroke.direction = oppositeDirection(stroke.direction);
      }
    }
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "fallback piston pull");
      if (!stroke.valid && stroke.action === -1 &&
          this.world.orientationAtIndex(stroke.base) === Direction.Down) {
        stroke.valid = this.propose(stroke);
      }
    }
    this.rejectInvalidPartners();
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "recoiling piston stroke");
      if (!stroke.valid && stroke.action === 1) {
        stroke.recoil = true;
        stroke.direction = oppositeDirection(stroke.direction);
        stroke.valid = this.propose(stroke);
      }
    }
  }

  private rejectInvalidPartners(): void {
    // A shared welded load or base may require several matching strokes. Reject
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
  }

  /** Carried pistons stay rigid; matching actuators on a shared load cooperate. */
  private propose(stroke: Stroke): boolean {
    const links = magicLinksFor(this.world);
    links?.collect();
    stroke.cells.length = 0;
    stroke.partners.length = 0;
    this.beginVisit();
    const { base, arm, action, recoil, direction } = stroke;
    if (action === 1 && !recoil && arm < 0) {
      return false;
    }
    const head = arm < 0 ? -1 : this.neighbor(arm, this.world.orientationAtIndex(base));
    const seed = recoil ? base : action === 1 ? arm : stroke.headWelded ? head : -1;
    if (seed >= 0 && this.world.kindAtIndex(seed) !== TileKind.Empty) {
      this.enqueue(stroke, seed);
    }
    // Every moving body pushes contact chains, including a retracting welded load.
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
      if (links !== undefined && this.world.kindAtIndex(cell) === TileKind.MagicLink) {
        for (let edge = links.firstEdgeAt(cell); edge >= 0; edge = links.nextEdge(edge)) {
          this.enqueue(stroke, links.targetAt(edge));
        }
      }
      const destination = this.neighbor(cell, direction);
      if (destination < 0) {
        return false;
      }
      if (this.world.kindAtIndex(destination) !== TileKind.Empty &&
          !(action === -1 &&
            (destination === arm || this.partnerAt(stroke, cell, destination) >= 0))) {
        this.enqueue(stroke, destination);
      }
    }
    return true;
  }

  /** Split matching actuators approached from a shared load or lowering base. */
  private partnerAt(stroke: Stroke, head: number, connection: number): number {
    const orientation = this.world.orientationAtIndex(stroke.base);
    let base: number;
    if (stroke.recoil) {
      if (stroke.action !== -1 || this.neighbor(head, orientation) !== connection ||
          this.world.kindAtIndex(connection) !== TileKind.PistonArm ||
          !this.world.hasWeldAtIndex(head, orientation)) {
        return -1;
      }
      base = head;
    } else {
      if (this.neighbor(connection, orientation) !== head ||
          !this.world.hasWeldAtIndex(connection, orientation)) {
        return -1;
      }
      base = stroke.action === 1 ? connection
        : this.world.kindAtIndex(connection) === TileKind.PistonArm
          ? this.neighbor(connection, oppositeDirection(orientation)) : -1;
    }
    const index = base < 0 ? -1 : expectDefined(this.strokeAt[base], "cooperating piston index");
    if (index < 0 || base === stroke.base) {
      return -1;
    }
    const partner = expectDefined(this.strokes[index], "cooperating piston");
    return partner.action === stroke.action && partner.recoil === stroke.recoil &&
      this.world.orientationAtIndex(base) === orientation ? index : -1;
  }

  private enqueue(stroke: Stroke, cell: number): void {
    if (this.visited[cell] !== this.visit) {
      this.visited[cell] = this.visit;
      stroke.cells.push(cell);
    }
  }

  private beginVisit(): void {
    this.visit = (this.visit + 1) >>> 0;
    if (this.visit === 0) {
      this.visited.fill(0);
      this.visit = 1;
    }
  }

  /** Order nested pending actuators, not their passive cargo, before a rigid carrier. */
  private carriesStrictSubset(stroke: Stroke, carrier: Stroke): boolean {
    if (stroke.direction !== carrier.direction) {
      return false;
    }
    this.beginVisit();
    let carrierCount = 0;
    for (const cell of carrier.cells) {
      const index = expectDefined(this.strokeAt[cell], "carrier piston index");
      if (index >= 0 && expectDefined(this.strokes[index], "carrier piston stroke").valid) {
        this.visited[cell] = this.visit;
        carrierCount += 1;
      }
    }
    let carriedCount = 0;
    for (const cell of stroke.cells) {
      const index = expectDefined(this.strokeAt[cell], "nested piston index");
      if (index < 0 || !expectDefined(this.strokes[index], "nested piston stroke").valid) {
        continue;
      }
      if (this.visited[cell] !== this.visit) {
        return false;
      }
      carriedCount += 1;
    }
    // Include an actuator's own base when recoil moves it, unlike a stationary-base pull.
    return carriedCount < carrierCount;
  }

  private chooseReadyStrokes(breakCycles = false): void {
    if (breakCycles) {
      this.labelDependencyCycles();
    }
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "piston stroke");
      stroke.ready = stroke.valid;
      if (!stroke.valid) {
        continue;
      }
      for (const cell of stroke.cells) {
        const carried = expectDefined(this.strokeAt[cell], "carried piston stroke");
        if (carried < 0 || carried === index || stroke.partners.includes(carried)) {
          continue;
        }
        const dependency = expectDefined(this.strokes[carried], "carried piston proposal");
        if (!dependency.valid) {
          continue;
        }
        // Inside a cycle, finish nested same-direction motion before its carrier.
        // Equal/overlapping actuator sets tie; perpendicular ties retain vertical priority.
        // Acyclic dependencies and required partners always remain binding.
        if (breakCycles && stroke.dependencyComponent === dependency.dependencyComponent &&
            (this.carriesStrictSubset(stroke, dependency) ||
              (stroke.direction & 1) === 0 && (dependency.direction & 1) === 1)) {
          continue;
        }
        stroke.ready = false;
        break;
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
  }

  /** Iterative Tarjan traversal: linear in the stalled dependency graph, without recursion. */
  private labelDependencyCycles(): void {
    this.dependencyPath.length = 0;
    this.dependencyStack.length = 0;
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "piston dependency node");
      stroke.dependencies.length = 0;
      stroke.dependencyIndex = -1;
      stroke.dependencyLow = -1;
      stroke.dependencyComponent = -1;
      stroke.dependencyCursor = 0;
      if (!stroke.valid) {
        continue;
      }
      for (const cell of stroke.cells) {
        const carried = expectDefined(this.strokeAt[cell], "piston dependency index");
        if (carried >= 0 && carried !== index &&
            expectDefined(this.strokes[carried], "piston dependency target").valid) {
          stroke.dependencies.push(carried);
        }
      }
      for (const partner of stroke.partners) {
        if (expectDefined(this.strokes[partner], "piston dependency partner").valid) {
          stroke.dependencies.push(partner);
        }
      }
    }
    let discovery = 0;
    for (let start = 0; start < this.strokeCount; start += 1) {
      const root = expectDefined(this.strokes[start], "piston dependency root");
      if (!root.valid || root.dependencyIndex >= 0) {
        continue;
      }
      this.dependencyPath.push(start);
      while (this.dependencyPath.length > 0) {
        const index = expectDefined(this.dependencyPath[this.dependencyPath.length - 1], "piston DFS node");
        const stroke = expectDefined(this.strokes[index], "piston DFS stroke");
        if (stroke.dependencyIndex < 0) {
          stroke.dependencyIndex = discovery++;
          stroke.dependencyLow = stroke.dependencyIndex;
          this.dependencyStack.push(index);
        }
        if (stroke.dependencyCursor < stroke.dependencies.length) {
          const target = expectDefined(stroke.dependencies[stroke.dependencyCursor++], "piston DFS edge");
          const dependency = expectDefined(this.strokes[target], "piston DFS target");
          if (dependency.dependencyIndex < 0) {
            this.dependencyPath.push(target);
          } else if (dependency.dependencyComponent < 0) {
            stroke.dependencyLow = Math.min(stroke.dependencyLow, dependency.dependencyIndex);
          }
          continue;
        }
        this.dependencyPath.pop();
        if (stroke.dependencyLow === stroke.dependencyIndex) {
          let member: number;
          do {
            member = expectDefined(this.dependencyStack.pop(), "piston cycle member");
            expectDefined(this.strokes[member], "piston cycle stroke").dependencyComponent = index;
          } while (member !== index);
        }
        if (this.dependencyPath.length > 0) {
          const parent = expectDefined(this.dependencyPath[this.dependencyPath.length - 1], "piston DFS parent");
          const parentStroke = expectDefined(this.strokes[parent], "piston DFS parent stroke");
          parentStroke.dependencyLow = Math.min(parentStroke.dependencyLow, stroke.dependencyLow);
        }
      }
    }
  }

  private resolveConflicts(): void {
    this.sweepOwners.fill(-1);
    this.destinationOwners.fill(-1);
    for (let index = 0; index < this.strokeCount; index += 1) {
      const stroke = expectDefined(this.strokes[index], "piston conflict group");
      stroke.parent = index;
      stroke.jammed = false;
    }
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
    this.retractingBases.fill(0);
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
        this.retractingBases[base] = stroke.recoil ? 1 : 0;
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
    const transitions = this.world.applyPistonTransitions(
      this.actions, this.headWelds, this.armIds, this.retractingBases,
    );
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
