import { expectDefined } from "../util/assert";
import { Direction, directionX, directionY, oppositeDirection, TileKind } from "./tile";
import type { World } from "./world";

interface SwapProposal {
  actuator: number;
  actuatorId: number;
  front: number;
  frontId: number;
  rear: number;
  rearId: number;
  jammed: boolean;
}

/** Side-input commands observe old identities; accepted swaps commit as one atomic batch. */
export class SwapperResolver {
  private readonly proposals: SwapProposal[] = [];
  private proposalCount = 0;
  private readonly claimOwners: Int32Array;
  private readonly pairs: number[] = [];

  constructor(private readonly world: World) {
    this.claimOwners = new Int32Array(world.cellCount);
  }

  clear(): void {
    this.proposalCount = 0;
  }

  collect(actuator: number): void {
    const direction = this.world.orientationAtIndex(actuator);
    const front = this.neighborIndex(actuator, direction);
    const rear = this.neighborIndex(actuator, oppositeDirection(direction));
    if (front < 0 || rear < 0) return;
    let proposal = this.proposals[this.proposalCount];
    if (proposal === undefined) {
      proposal = { actuator: 0, actuatorId: 0, front: 0, frontId: 0, rear: 0, rearId: 0, jammed: false };
      this.proposals.push(proposal);
    }
    this.proposalCount += 1;
    proposal.actuator = actuator;
    proposal.actuatorId = this.world.idAtIndex(actuator);
    proposal.front = front;
    proposal.frontId = this.world.idAtIndex(front);
    proposal.rear = rear;
    proposal.rearId = this.world.idAtIndex(rear);
    proposal.jammed = false;
  }

  commit(): number {
    if (this.proposalCount === 0) return 0;
    this.claimOwners.fill(-1);
    this.pairs.length = 0;
    for (let index = 0; index < this.proposalCount; index += 1) {
      const proposal = expectDefined(this.proposals[index], "swap proposal");
      if (this.world.kindAtIndex(proposal.actuator) !== TileKind.Swapper ||
          this.world.idAtIndex(proposal.actuator) !== proposal.actuatorId ||
          this.world.idAtIndex(proposal.front) !== proposal.frontId ||
          this.world.idAtIndex(proposal.rear) !== proposal.rearId ||
          !this.world.canSwapCellsAtIndices(proposal.front, proposal.rear)) {
        proposal.jammed = true;
        continue;
      }
      // Even a proposal already jammed by a rival must claim its remaining cells.
      this.claim(proposal.actuator, index);
      this.claim(proposal.front, index);
      this.claim(proposal.rear, index);
    }
    for (let index = 0; index < this.proposalCount; index += 1) {
      const proposal = expectDefined(this.proposals[index], "swap proposal");
      if (!proposal.jammed) this.pairs.push(proposal.front, proposal.rear);
    }
    this.clear();
    return this.world.swapCellPairs(this.pairs);
  }

  private claim(cell: number, index: number): void {
    const owner = expectDefined(this.claimOwners[cell], "swap claim owner");
    if (owner < 0) {
      this.claimOwners[cell] = index;
    } else if (owner !== index) {
      expectDefined(this.proposals[owner], "competing swap proposal").jammed = true;
      expectDefined(this.proposals[index], "swap proposal").jammed = true;
    }
  }

  private neighborIndex(index: number, direction: Direction): number {
    const x = index % this.world.width + directionX(direction);
    const y = Math.floor(index / this.world.width) + directionY(direction);
    return x >= 0 && x < this.world.width && y >= 0 && y < this.world.height
      ? y * this.world.width + x : -1;
  }
}
