import type { CommunityClient } from "../game/community-client";
import type { PuzzleScores } from "../game/puzzle-scores";
import { expectDefined } from "../util/assert";
import { renderScoreHistograms } from "./score-histograms";

/** Keep local scores visible independently of optional community requests. */
export class CommunityScoresView {
  private briefingRequest = 0;
  private reportRequest = 0;

  constructor(
    private readonly client: CommunityClient | null,
    private readonly briefing: HTMLElement,
    private readonly report: HTMLElement,
    private readonly briefingCharts: HTMLElement,
    private readonly reportCharts: HTMLElement,
  ) {}

  async showBriefing(puzzleId: string, best: PuzzleScores | null): Promise<void> {
    const request = ++this.briefingRequest;
    renderScoreHistograms(this.briefingCharts, null, best, null);
    this.briefing.hidden = false;
    if (this.client === null) {
      this.briefing.textContent = "Community scores are not configured. Personal bests are saved locally.";
      return;
    }
    this.briefing.textContent = "Loading community scores…";
    try {
      const data = await this.client.histograms(puzzleId);
      if (request === this.briefingRequest) {
        this.briefing.textContent = playerCount(data.players);
        renderScoreHistograms(this.briefingCharts, data, best, null);
      }
    } catch (error) {
      if (request === this.briefingRequest) {
        this.briefing.textContent = "Community scores unavailable. Local play is unaffected.";
      }
      console.warn("Could not load community scores:", error);
    }
  }

  async recordResult(
    puzzleId: string,
    current: PuzzleScores | null,
    submission: PuzzleScores | null,
    best: PuzzleScores | null,
  ): Promise<void> {
    const request = ++this.reportRequest;
    this.report.hidden = current === null;
    this.reportCharts.hidden = current === null;
    this.reportCharts.replaceChildren();
    if (current === null) return;
    renderScoreHistograms(this.reportCharts, null, best, current);
    if (this.client === null) {
      this.report.textContent = "Saved locally. Community scores are not configured.";
      return;
    }
    this.report.textContent = "Saved locally. Submitting community score…";
    let submitted = false;
    try {
      await this.client.submitScores(puzzleId, expectDefined(submission ?? undefined, "Successful result needs submission scores"));
      submitted = true;
    } catch (error) {
      console.warn("Could not submit community score:", error);
    }
    if (request !== this.reportRequest) return;
    const status = submitted ? "Score submitted." : "Saved locally; score not submitted. Complete another test run to try again.";
    this.report.textContent = `${status} Loading community scores…`;
    try {
      const data = await this.client.histograms(puzzleId);
      if (request === this.reportRequest) {
        this.report.textContent = `${status} ${playerCount(data.players)}`;
        renderScoreHistograms(this.reportCharts, data, best, current);
      }
    } catch (error) {
      if (request === this.reportRequest) {
        this.report.textContent = `${status} Community scores temporarily unavailable.`;
      }
      console.warn("Could not refresh community scores:", error);
    }
  }
}

function playerCount(players: number): string {
  return `Community scores: ${players} ${players === 1 ? "player" : "players"}.`;
}
