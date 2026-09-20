import { expectDefined } from "../util/assert";
import { magicLinksFor } from "./magic-link";
import { ContactDestruction, contactDestruction } from "./motion-contact";
import { recordRotationAnimation } from "./rotation-animation";
import { recordShatterEffects } from "./shatter-animation";
import {
  Direction,
  directionX,
  directionY,
  oppositeDirection,
  TILE_DEFINITIONS,
  TileKind,
} from "./tile";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

interface RotationProposal {
  pivot: number;
  grip: number;
  headWelded: boolean;
  quarterTurn: -1 | 1;
  nextDirection: Direction;
  blocked: boolean;
  jammed: boolean;
  readonly selected: number[];
  readonly sweep: number[];
  readonly victims: number[];
  readonly victimContacts: number[];
}

/**
 * Resolves quarter-turns around stationary rotator cells, trying opposite base
 * rotation when the gripped body's turn is geometrically blocked. Collision is
 * tile-discrete: non-destructive swept bodies and enclosed contents join the turn
 * recursively. Destructive contacts cut individual cells only after acceptance.
 * Fixed bodies, out-of-bounds sweeps, or capture of the stationary body block it.
 */
export class RotatorResolver {
  private readonly world: World;
  private readonly selected: Uint8Array;
  private readonly sweep: Uint8Array;
  private readonly captured: Uint8Array;
  private readonly destroyed: Uint8Array;
  private readonly reachable: Uint8Array;
  private readonly queue: Int32Array;
  private readonly sweepOwners: Int32Array;
  private readonly pivotOwners: Int32Array;
  private readonly proposals: RotationProposal[] = [];
  private proposalCount = 0;
  private sweepLeavesWorld = false;

  constructor(world: World) {
    this.world = world;
    this.selected = new Uint8Array(world.cellCount);
    this.sweep = new Uint8Array(world.cellCount);
    this.captured = new Uint8Array(world.cellCount);
    this.destroyed = new Uint8Array(world.cellCount);
    this.reachable = new Uint8Array(world.cellCount);
    this.queue = new Int32Array(world.cellCount);
    this.sweepOwners = new Int32Array(world.cellCount);
    this.pivotOwners = new Int32Array(world.cellCount);
  }

  resolve(): number {
    this.proposalCount = 0;
    for (
      let pivot = this.world.firstFeatureIndex(WorldFeature.Rotator);
      pivot >= 0;
      pivot = this.world.nextFeatureIndex(WorldFeature.Rotator, pivot)
    ) {
      const orientation = this.world.orientationAtIndex(pivot);
      const direction = this.world.rotatorDirectionAtIndex(pivot);
      const rear = oppositeDirection(orientation);
      if (direction === rear) {
        throw new Error(`Rotator at index ${pivot} points toward its rear input`);
      }
      const charge = this.world.chargeAtPortIndex(pivot, rear);
      if (charge === 0) {
        continue;
      }
      const quarterTurn = (this.world.mirroredAtIndex(pivot) ? -charge : charge) as -1 | 1;
      const nextDirection = ((direction + quarterTurn + 4) & 3) as Direction;
      if (nextDirection === rear) {
        continue;
      }
      const proposal = this.takeProposal();
      proposal.pivot = pivot;
      proposal.grip = this.neighborIndex(pivot, direction);
      proposal.headWelded = this.world.hasWeldAtIndex(pivot, direction);
      proposal.quarterTurn = quarterTurn;
      proposal.nextDirection = nextDirection;
      this.buildProposal(proposal, direction);
      if (proposal.blocked) {
        // Competing feasible turns still jam; only geometry can trigger reaction.
        proposal.quarterTurn = -quarterTurn as -1 | 1;
        proposal.nextDirection = direction;
        this.buildProposal(proposal, direction, true);
      }
    }

    this.markConflicts();
    // Empty grips turn freely, even when another proposal carries their base.
    // Commit them before cell movement so the carrier transforms the new direction.
    for (let proposalIndex = 0; proposalIndex < this.proposalCount; proposalIndex += 1) {
      const proposal = expectDefined(this.proposals[proposalIndex], "rotation proposal");
      if (proposal.selected.length === 0 && !proposal.blocked && !proposal.jammed) {
        this.world.setRotatorDirectionAtIndex(proposal.pivot, proposal.nextDirection);
      }
    }
    let rotatedCellCount = 0;
    for (let proposalIndex = 0; proposalIndex < this.proposalCount; proposalIndex += 1) {
      const proposal = expectDefined(this.proposals[proposalIndex], "rotation proposal");
      if (proposal.blocked || proposal.jammed || proposal.selected.length === 0) {
        continue;
      }
      this.selected.fill(0);
      for (const index of proposal.selected) {
        this.selected[index] = 1;
      }
      recordRotationAnimation(
        this.world,
        proposal.selected,
        proposal.pivot,
        proposal.quarterTurn,
      );
      const pivotId = this.world.idAtIndex(proposal.pivot);
      const gripId = this.world.idAtIndex(proposal.grip);
      if (proposal.headWelded) {
        this.setHeadWeld(proposal.pivot, proposal.grip, false);
      }
      for (let index = 0; index < proposal.victims.length; index += 1) {
        const victim = expectDefined(proposal.victims[index], "rotation victim");
        recordShatterEffects(
          this.world, victim, expectDefined(proposal.victimContacts[index], "rotation contact"),
        );
        this.world.place(victim % this.world.width, Math.floor(victim / this.world.width), TileKind.Empty);
        this.selected[victim] = 0;
      }
      rotatedCellCount += this.world.rotateCells(
        this.selected,
        proposal.pivot,
        proposal.quarterTurn,
      );
      const pivotSurvives = this.world.idAtIndex(proposal.pivot) === pivotId;
      if (pivotSurvives) {
        this.world.setRotatorDirectionAtIndex(proposal.pivot, proposal.nextDirection);
      }
      const head = this.neighborIndex(proposal.pivot, proposal.nextDirection);
      if (proposal.headWelded && pivotSurvives && this.world.idAtIndex(head) === gripId) {
        this.setHeadWeld(
          proposal.pivot,
          this.neighborIndex(proposal.pivot, proposal.nextDirection),
          true,
        );
      }
      if (this.world.hasFeature(WorldFeature.Fastener)) {
        for (const source of proposal.selected) {
          if (this.selected[source] === 0) continue;
          const destination = this.destinationFor(source, proposal.pivot, proposal.quarterTurn);
          if (this.world.kindAtIndex(destination) === TileKind.Fastener) {
            const x = destination % this.world.width;
            recordShatterEffects(this.world, destination);
            this.world.place(x, (destination - x) / this.world.width, TileKind.Empty);
          }
        }
      }
    }
    return rotatedCellCount;
  }

  private takeProposal(): RotationProposal {
    let proposal = this.proposals[this.proposalCount];
    if (proposal === undefined) {
      proposal = {
        pivot: -1,
        grip: -1,
        headWelded: false,
        quarterTurn: 1,
        nextDirection: Direction.Up,
        blocked: false,
        jammed: false,
        selected: [],
        sweep: [],
        victims: [],
        victimContacts: [],
      };
      this.proposals.push(proposal);
    }
    this.proposalCount += 1;
    proposal.blocked = false;
    proposal.jammed = false;
    proposal.selected.length = 0;
    proposal.sweep.length = 0;
    proposal.victims.length = 0;
    proposal.victimContacts.length = 0;
    return proposal;
  }

  private buildProposal(
    proposal: RotationProposal,
    direction: Direction,
    reaction = false,
  ): void {
    this.selected.fill(0);
    this.destroyed.fill(0);
    proposal.selected.length = 0;
    const target = this.neighborIndex(proposal.pivot, direction);
    const stationary = reaction ? target : proposal.pivot;
    const seed = reaction ? proposal.pivot : target;
    if (seed >= 0 && this.world.kindAtIndex(seed) !== TileKind.Empty) {
      this.addBodyAt(seed, proposal);
    }

    let changed: boolean;
    do {
      this.buildSweep(proposal);
      changed = false;
      for (
        let index = this.world.firstFeatureIndex(WorldFeature.Occupied);
        index >= 0;
        index = this.world.nextFeatureIndex(WorldFeature.Occupied, index)
      ) {
        if (this.selected[index] === 0 && this.captured[index] === 1 && this.destroyed[index] === 0) {
          this.addBodyAt(index, proposal);
          changed = true;
        }
      }
      this.collectContainedBodies();
      for (
        let index = this.world.firstFeatureIndex(WorldFeature.Occupied);
        index >= 0;
        index = this.world.nextFeatureIndex(WorldFeature.Occupied, index)
      ) {
        if (this.selected[index] === 0 && this.reachable[index] === 0 && this.destroyed[index] === 0) {
          this.addBodyAt(index, proposal);
          changed = true;
        }
      }
    } while (changed);

    proposal.blocked = this.sweepLeavesWorld || this.selected[stationary] === 1;
    for (const source of proposal.selected) {
      if (TILE_DEFINITIONS[this.world.kindAtIndex(source)].immovable) {
        proposal.blocked = true;
        break;
      }
      const destination = this.destinationFor(
        source,
        proposal.pivot,
        proposal.quarterTurn,
      );
      if (
        destination < 0 ||
        (this.world.kindAtIndex(destination) !== TileKind.Empty &&
          this.selected[destination] === 0 && this.destroyed[destination] === 0 &&
          this.destroyed[source] === 0)
      ) {
        proposal.blocked = true;
        break;
      }
    }
    if (reaction && !proposal.blocked) {
      // Claim the stationary grip too: another turn must not carry it away.
      proposal.sweep.push(target);
    }
  }

  private addBodyAt(index: number, proposal: RotationProposal): void {
    if (this.selected[index] === 1 || this.destroyed[index] === 1) {
      return;
    }
    // Potentially cut cells cannot transmit capture into the untouched remainder
    // of a body. Its surviving welds still determine which fragments join the turn.
    const links = magicLinksFor(this.world);
    links?.collect();
    const start = proposal.selected.length;
    this.selected[index] = 1;
    proposal.selected.push(index);
    for (let cursor = start; cursor < proposal.selected.length; cursor += 1) {
      const cell = expectDefined(proposal.selected[cursor], "rotator body member");
      for (let side: Direction = Direction.Up; side <= Direction.Left; side += 1) {
        if (!this.world.hasWeldAtIndex(cell, side)) {
          continue;
        }
        const other = this.neighborIndex(cell, side);
        if ((cell === proposal.pivot && other === proposal.grip) ||
            (cell === proposal.grip && other === proposal.pivot)) {
          continue;
        }
        if (this.selected[other] === 0 && this.destroyed[other] === 0) {
          this.selected[other] = 1;
          proposal.selected.push(other);
        }
      }
      if (links !== undefined && this.world.kindAtIndex(cell) === TileKind.MagicLink) {
        for (let edge = links.firstEdgeAt(cell); edge >= 0; edge = links.nextEdge(edge)) {
          const other = links.targetAt(edge);
          if (this.selected[other] === 0 && this.destroyed[other] === 0) {
            this.selected[other] = 1;
            proposal.selected.push(other);
          }
        }
      }
    }
  }

  private setHeadWeld(pivot: number, grip: number, welded: boolean): void {
    const pivotX = pivot % this.world.width;
    const gripX = grip % this.world.width;
    if (!this.world.setWeld(
      pivotX, (pivot - pivotX) / this.world.width,
      gripX, (grip - gripX) / this.world.width,
      welded,
    )) {
      throw new Error(`Cannot ${welded ? "restore" : "split"} rotator head weld at ${pivot}`);
    }
  }

  private buildSweep(proposal: RotationProposal): void {
    this.sweep.fill(0);
    this.captured.fill(0);
    this.destroyed.fill(0);
    proposal.victims.length = 0;
    proposal.victimContacts.length = 0;
    proposal.sweep.length = 0;
    this.sweepLeavesWorld = false;
    const pivotX = proposal.pivot % this.world.width;
    const pivotY = (proposal.pivot - pivotX) / this.world.width;
    for (const source of proposal.selected) {
      const sourceX = source % this.world.width;
      const sourceY = (source - sourceX) / this.world.width;
      const deltaX = sourceX - pivotX;
      const deltaY = sourceY - pivotY;
      const radius = Math.hypot(deltaX, deltaY);
      const steps = Math.max(1, Math.ceil(radius * Math.PI * 2.5));
      let previousX = sourceX;
      let previousY = sourceY;
      this.markSweepCell(previousX, previousY, source, proposal);
      for (let step = 1; step <= steps; step += 1) {
        const angle = proposal.quarterTurn * step * Math.PI / (steps * 2);
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const x = Math.floor(pivotX + deltaX * cosine - deltaY * sine + 0.5);
        const y = Math.floor(pivotY + deltaX * sine + deltaY * cosine + 0.5);
        if (x !== previousX && y !== previousY) {
          this.markSweepCell(x, previousY, source, proposal);
          this.markSweepCell(previousX, y, source, proposal);
        }
        this.markSweepCell(x, y, source, proposal);
        previousX = x;
        previousY = y;
      }
    }
  }

  private markSweepCell(x: number, y: number, source: number, proposal: RotationProposal): void {
    if (x < 0 || x >= this.world.width || y < 0 || y >= this.world.height) {
      this.sweepLeavesWorld = true;
      return;
    }
    const index = y * this.world.width + x;
    if (this.sweep[index] === 0) {
      this.sweep[index] = 1;
      proposal.sweep.push(index);
    }
    // Every selected cell vacates its source with the same rigid transform.
    // Passing through a co-moving source is not contact, even for destroyers.
    if (this.selected[index] === 1 || this.world.kindAtIndex(index) === TileKind.Empty) {
      return;
    }
    const destruction = contactDestruction(this.world.kindAtIndex(source), this.world.kindAtIndex(index));
    if (destruction === ContactDestruction.None) {
      this.captured[index] = 1;
    } else {
      if ((destruction & ContactDestruction.Source) !== 0) this.markVictim(source, index, proposal);
      if ((destruction & ContactDestruction.Target) !== 0) this.markVictim(index, index, proposal);
    }
  }

  private markVictim(victim: number, contact: number, proposal: RotationProposal): void {
    if (this.destroyed[victim] === 1) return;
    this.destroyed[victim] = 1;
    proposal.victims.push(victim);
    proposal.victimContacts.push(contact);
  }

  /** Marks every cell reachable from the board edge without crossing a selected cell. */
  private collectContainedBodies(): void {
    this.reachable.fill(0);
    let head = 0;
    let tail = 0;
    const enqueue = (index: number): void => {
      if (this.selected[index] === 0 && this.reachable[index] === 0) {
        this.reachable[index] = 1;
        this.queue[tail] = index;
        tail += 1;
      }
    };
    for (let x = 0; x < this.world.width; x += 1) {
      enqueue(x);
      enqueue((this.world.height - 1) * this.world.width + x);
    }
    for (let y = 1; y < this.world.height - 1; y += 1) {
      enqueue(y * this.world.width);
      enqueue(y * this.world.width + this.world.width - 1);
    }
    while (head < tail) {
      const index = expectDefined(this.queue[head], "rotation containment queue");
      head += 1;
      const x = index % this.world.width;
      if (index >= this.world.width) {
        enqueue(index - this.world.width);
      }
      if (x < this.world.width - 1) {
        enqueue(index + 1);
      }
      if (index < this.world.cellCount - this.world.width) {
        enqueue(index + this.world.width);
      }
      if (x > 0) {
        enqueue(index - 1);
      }
    }
  }

  private markConflicts(): void {
    this.sweepOwners.fill(-1);
    this.pivotOwners.fill(-1);
    for (let index = 0; index < this.proposalCount; index += 1) {
      const proposal = expectDefined(this.proposals[index], "rotation proposal");
      if (!proposal.blocked && proposal.selected.length > 0) {
        this.pivotOwners[proposal.pivot] = index;
      }
    }
    for (let index = 0; index < this.proposalCount; index += 1) {
      const proposal = expectDefined(this.proposals[index], "rotation proposal");
      if (proposal.blocked) {
        continue;
      }
      for (const sweptCell of proposal.sweep) {
        const owner = expectDefined(this.sweepOwners[sweptCell], "rotation sweep owner");
        if (owner >= 0 && owner !== index) {
          proposal.jammed = true;
          expectDefined(this.proposals[owner], "conflicting rotation proposal").jammed = true;
        } else if (owner < 0) {
          this.sweepOwners[sweptCell] = index;
        }
        const pivotOwner = expectDefined(
          this.pivotOwners[sweptCell],
          "rotation pivot owner",
        );
        if (pivotOwner >= 0 && pivotOwner !== index) {
          proposal.jammed = true;
          expectDefined(
            this.proposals[pivotOwner],
            "swept rotation proposal",
          ).jammed = true;
        }
      }
    }
  }

  private destinationFor(source: number, pivot: number, quarterTurn: -1 | 1): number {
    const pivotX = pivot % this.world.width;
    const pivotY = (pivot - pivotX) / this.world.width;
    const sourceX = source % this.world.width;
    const sourceY = (source - sourceX) / this.world.width;
    const deltaX = sourceX - pivotX;
    const deltaY = sourceY - pivotY;
    const destinationX = pivotX + (quarterTurn === 1 ? -deltaY : deltaY);
    const destinationY = pivotY + (quarterTurn === 1 ? deltaX : -deltaX);
    return destinationX < 0 ||
        destinationX >= this.world.width ||
        destinationY < 0 ||
        destinationY >= this.world.height
      ? -1
      : destinationY * this.world.width + destinationX;
  }

  private neighborIndex(index: number, direction: Direction): number {
    const x = index % this.world.width;
    const neighborX = x + directionX(direction);
    const neighborY = (index - x) / this.world.width + directionY(direction);
    return neighborX < 0 ||
        neighborX >= this.world.width ||
        neighborY < 0 ||
        neighborY >= this.world.height
      ? -1
      : neighborY * this.world.width + neighborX;
  }
}
