import { expectDefined } from "../util/assert";
import { recordFlipAnimation } from "./flip-animation";
import { magicLinksFor } from "./magic-link";
import { recordShatterEffects } from "./shatter-animation";
import {
  Direction,
  directionX,
  directionY,
  flipDirectionHorizontally,
  flipDirectionVertically,
  mirroringForKind,
  oppositeDirection,
  orientationForKind,
  orientedSides,
  TILE_DEFINITIONS,
  TileKind,
} from "./tile";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

interface FlipProposal {
  actuator: number;
  actuatorDestination: number;
  pivot: number;
  horizontally: boolean;
  headWelded: boolean;
  blocked: boolean;
  jammed: boolean;
  readonly selected: number[];
  readonly destinations: number[];
}

/** Reflects the front mechanical body around its front cell, without swept capture. */
export class FlipperResolver {
  private readonly selected: Uint8Array;
  private readonly claimOwners: Int32Array;
  private readonly proposals: FlipProposal[] = [];
  private proposalCount = 0;

  constructor(private readonly world: World) {
    this.selected = new Uint8Array(world.cellCount);
    this.claimOwners = new Int32Array(world.cellCount);
  }

  resolve(): number {
    this.proposalCount = 0;
    for (
      let actuator = this.world.firstFeatureIndex(WorldFeature.Flipper);
      actuator >= 0;
      actuator = this.world.nextFeatureIndex(WorldFeature.Flipper, actuator)
    ) {
      const direction = this.world.orientationAtIndex(actuator);
      const charge = this.world.chargeAtPortIndex(actuator, oppositeDirection(direction));
      if (charge === 0) {
        continue;
      }
      const pivot = this.neighborIndex(actuator, direction);
      if (pivot < 0 || this.world.kindAtIndex(pivot) === TileKind.Empty) {
        continue;
      }
      const proposal = this.takeProposal();
      proposal.actuator = actuator;
      proposal.pivot = pivot;
      // Positive swaps local left/right; negative swaps forward/backward.
      proposal.horizontally = (charge === 1) === (directionX(direction) === 0);
      proposal.headWelded = this.world.hasWeldAtIndex(actuator, direction);
      this.buildProposal(proposal, direction);
    }

    this.markConflicts();
    let flippedCellCount = 0;
    for (let index = 0; index < this.proposalCount; index += 1) {
      const proposal = expectDefined(this.proposals[index], "flip proposal");
      if (proposal.blocked || proposal.jammed) {
        continue;
      }
      this.selected.fill(0);
      for (const source of proposal.selected) {
        this.selected[source] = 1;
      }
      recordFlipAnimation(this.world, proposal.selected, proposal.pivot, proposal.horizontally);
      if (proposal.headWelded) {
        this.setHeadWeld(proposal.actuator, proposal.pivot, false);
      }
      flippedCellCount += this.world.flipCells(
        this.selected, proposal.pivot, proposal.horizontally,
      );
      if (proposal.headWelded) {
        this.setHeadWeld(proposal.actuatorDestination, proposal.pivot, true);
      }
      // Fasteners remain solid until the original head seam is restored.
      if (this.world.hasFeature(WorldFeature.Fastener)) {
        for (const destination of proposal.destinations) {
          if (this.world.kindAtIndex(destination) === TileKind.Fastener) {
            const x = destination % this.world.width;
            recordShatterEffects(this.world, destination);
            this.world.place(x, (destination - x) / this.world.width, TileKind.Empty);
          }
        }
      }
    }
    return flippedCellCount;
  }

  private takeProposal(): FlipProposal {
    let proposal = this.proposals[this.proposalCount];
    if (proposal === undefined) {
      proposal = {
        actuator: -1,
        actuatorDestination: -1,
        pivot: -1,
        horizontally: true,
        headWelded: false,
        blocked: false,
        jammed: false,
        selected: [],
        destinations: [],
      };
      this.proposals.push(proposal);
    }
    this.proposalCount += 1;
    proposal.blocked = false;
    proposal.jammed = false;
    proposal.selected.length = 0;
    proposal.destinations.length = 0;
    return proposal;
  }

  private buildProposal(proposal: FlipProposal, direction: Direction): void {
    this.selected.fill(0);
    this.collectBody(proposal);
    for (const source of proposal.selected) {
      const destination = this.destinationFor(source, proposal.pivot, proposal.horizontally);
      if (
        TILE_DEFINITIONS[this.world.kindAtIndex(source)].immovable ||
        destination < 0 ||
        (this.world.kindAtIndex(destination) !== TileKind.Empty && this.selected[destination] === 0)
      ) {
        proposal.blocked = true;
        return;
      }
      proposal.destinations.push(destination);
    }
    const carriesActuator = this.selected[proposal.actuator] === 1;
    proposal.actuatorDestination = carriesActuator
      ? this.destinationFor(proposal.actuator, proposal.pivot, proposal.horizontally)
      : proposal.actuator;
    if (proposal.headWelded) {
      const headDirection = carriesActuator
        ? this.flipDirection(direction, proposal.horizontally)
        : direction;
      // The pivot stays occupied, but its reflected frame may reject the stationary base.
      // Probe both endpoints without changing a frame or splitting any seam.
      if (!this.canWeldAfterFlip(proposal.actuator, headDirection, carriesActuator, proposal.horizontally) ||
          !this.canWeldAfterFlip(proposal.pivot, oppositeDirection(headDirection), true, proposal.horizontally)) {
        proposal.blocked = true;
      }
    }
  }

  private collectBody(proposal: FlipProposal): void {
    const links = magicLinksFor(this.world);
    links?.collect();
    this.selected[proposal.pivot] = 1;
    proposal.selected.push(proposal.pivot);
    for (let cursor = 0; cursor < proposal.selected.length; cursor += 1) {
      const cell = expectDefined(proposal.selected[cursor], "flipper body member");
      for (let side: Direction = Direction.Up; side <= Direction.Left; side += 1) {
        if (!this.world.hasWeldAtIndex(cell, side)) {
          continue;
        }
        const other = this.neighborIndex(cell, side);
        if ((cell === proposal.actuator && other === proposal.pivot) ||
            (cell === proposal.pivot && other === proposal.actuator)) {
          continue;
        }
        if (this.selected[other] === 0) {
          this.selected[other] = 1;
          proposal.selected.push(other);
        }
      }
      // Alternate physical or magic-link paths may deliberately carry the actuator itself.
      if (links !== undefined && this.world.kindAtIndex(cell) === TileKind.MagicLink) {
        for (let edge = links.firstEdgeAt(cell); edge >= 0; edge = links.nextEdge(edge)) {
          const other = links.targetAt(edge);
          if (this.selected[other] === 0) {
            this.selected[other] = 1;
            proposal.selected.push(other);
          }
        }
      }
    }
  }

  private canWeldAfterFlip(
    source: number,
    side: Direction,
    reflected: boolean,
    horizontally: boolean,
  ): boolean {
    const kind = this.world.kindAtIndex(source);
    const definition = TILE_DEFINITIONS[kind];
    const orientation = this.world.orientationAtIndex(source);
    const transformedOrientation = reflected
      ? orientationForKind(kind, this.flipDirection(orientation, horizontally))
      : orientation;
    const mirrored = this.world.mirroredAtIndex(source);
    const transformedMirroring = reflected ? mirroringForKind(kind, !mirrored) : mirrored;
    let weldableSides = orientedSides(definition.weldableSides, transformedOrientation, transformedMirroring);
    if (kind === TileKind.Rotator) {
      const grip = this.world.rotatorDirectionAtIndex(source);
      weldableSides |= 1 << (reflected ? this.flipDirection(grip, horizontally) : grip);
    }
    return (weldableSides & (1 << side)) !== 0 &&
      (!definition.excludesFacingWeld || transformedOrientation !== side);
  }

  private markConflicts(): void {
    this.claimOwners.fill(-1);
    for (let index = 0; index < this.proposalCount; index += 1) {
      const proposal = expectDefined(this.proposals[index], "flip proposal");
      if (proposal.blocked) {
        continue;
      }
      this.claimCell(proposal.actuator, index);
      for (const source of proposal.selected) {
        this.claimCell(source, index);
      }
      for (const destination of proposal.destinations) {
        this.claimCell(destination, index);
      }
    }
  }

  private claimCell(cell: number, index: number): void {
    const owner = expectDefined(this.claimOwners[cell], "flip cell owner");
    if (owner < 0) {
      this.claimOwners[cell] = index;
    } else if (owner !== index) {
      expectDefined(this.proposals[index], "conflicting flip proposal").jammed = true;
      expectDefined(this.proposals[owner], "conflicting flip owner").jammed = true;
    }
    // Never release a jammed claim or stop claiming: a third rival must jam too.
  }

  private setHeadWeld(actuator: number, pivot: number, welded: boolean): void {
    const actuatorX = actuator % this.world.width;
    const pivotX = pivot % this.world.width;
    if (!this.world.setWeld(
      actuatorX, (actuator - actuatorX) / this.world.width,
      pivotX, (pivot - pivotX) / this.world.width,
      welded,
    )) {
      throw new Error(`Cannot ${welded ? "restore" : "split"} flipper head weld at ${actuator}`);
    }
  }

  private flipDirection(direction: Direction, horizontally: boolean): Direction {
    return horizontally ? flipDirectionHorizontally(direction) : flipDirectionVertically(direction);
  }

  private destinationFor(source: number, pivot: number, horizontally: boolean): number {
    const sourceX = source % this.world.width;
    const sourceY = (source - sourceX) / this.world.width;
    const pivotX = pivot % this.world.width;
    const pivotY = (pivot - pivotX) / this.world.width;
    const x = horizontally ? 2 * pivotX - sourceX : sourceX;
    const y = horizontally ? sourceY : 2 * pivotY - sourceY;
    return x < 0 || x >= this.world.width || y < 0 || y >= this.world.height
      ? -1
      : y * this.world.width + x;
  }

  private neighborIndex(index: number, direction: Direction): number {
    const x = index % this.world.width;
    const neighborX = x + directionX(direction);
    const neighborY = (index - x) / this.world.width + directionY(direction);
    return neighborX < 0 || neighborX >= this.world.width ||
      neighborY < 0 || neighborY >= this.world.height
      ? -1
      : neighborY * this.world.width + neighborX;
  }
}
