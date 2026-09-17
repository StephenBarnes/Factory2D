import type { CommunityClient } from "../game/community-client";
import type { PuzzleScores } from "../game/puzzle-scores";

/** Fetch distributions now; histogram charts and percentile ranks are a separate UI feature. */
export class CommunityScoresView {
  private briefingRequest = 0;
  private reportRequest = 0;

  constructor(
    private readonly client: CommunityClient | null,
    private readonly briefing: HTMLElement,
    private readonly report: HTMLElement,
  ) {}

  async showBriefing(puzzleId: string): Promise<void> {
    const request = ++this.briefingRequest;
    this.briefing.hidden = this.client === null;
    if (this.client === null) return;
    this.briefing.textContent = "Loading community scores…";
    try {
      const data = await this.client.histograms(puzzleId);
      if (request === this.briefingRequest) {
        this.briefing.textContent = playerCount(data.players);
      }
    } catch (error) {
      if (request === this.briefingRequest) {
        this.briefing.textContent = "Community scores unavailable. Local play is unaffected.";
      }
      console.warn("Could not load community scores:", error);
    }
  }

  async recordResult(puzzleId: string, scores: PuzzleScores | null): Promise<void> {
    const request = ++this.reportRequest;
    this.report.hidden = this.client === null || scores === null;
    if (this.client === null || scores === null) return;
    this.report.textContent = "Saved locally. Submitting community score…";
    try {
      await this.client.submitScores(puzzleId, scores);
    } catch (error) {
      if (request === this.reportRequest) {
        this.report.textContent = "Saved locally; score not submitted. Complete another test run to try again.";
      }
      console.warn("Could not submit community score:", error);
      return;
    }
    if (request === this.reportRequest) {
      this.report.textContent = "Community score submitted. Loading community scores…";
    }
    try {
      const data = await this.client.histograms(puzzleId);
      if (request === this.reportRequest) {
        this.report.textContent = `Score submitted. ${playerCount(data.players)}`;
      }
    } catch (error) {
      if (request === this.reportRequest) {
        this.report.textContent = "Score submitted. Community scores temporarily unavailable.";
      }
      console.warn("Could not refresh community scores:", error);
    }
  }
}

function playerCount(players: number): string {
  return `Community scores: ${players} ${players === 1 ? "player" : "players"}.`;
}
