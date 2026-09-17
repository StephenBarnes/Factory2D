import {
  API_SCORING_VERSION,
  SCORE_METRICS,
  type PuzzleHistograms,
  type ScoreSubmission,
  type SharedPuzzleReceipt,
} from "./community-api";
import type { PuzzleScores } from "./puzzle-scores";
import { serializeShippedPuzzle } from "./puzzles";

/** No credentials: installation IDs identify trusted players, not authenticated accounts. */
export class CommunityClient {
  private readonly baseUrl: string;
  private readonly revisions = new Map<string, Promise<string>>();

  constructor(baseUrl: string, private readonly installationId: string) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
      throw new Error("Community API URL must use HTTPS (or HTTP on localhost)");
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error("Community API URL must not contain credentials, a query, or a fragment");
    }
    this.baseUrl = url.href.replace(/\/$/, "");
  }

  async histograms(puzzleId: string): Promise<PuzzleHistograms> {
    const puzzleRevision = await this.revision(puzzleId);
    const query = new URLSearchParams({ revision: puzzleRevision, scoringVersion: String(API_SCORING_VERSION) });
    const value = await this.request(`/v1/puzzles/${encodeURIComponent(puzzleId)}/histograms?${query}`);
    const data = requireObject(value);
    const metrics = requireObject(data.metrics);
    if (data.puzzleId !== puzzleId || data.puzzleRevision !== puzzleRevision ||
      data.scoringVersion !== API_SCORING_VERSION || !Number.isSafeInteger(data.players) ||
      (data.players as number) < 0) {
      throw new Error("Community API returned an invalid histogram cohort");
    }
    for (const metric of SCORE_METRICS) {
      const buckets = metrics[metric];
      if (!Array.isArray(buckets)) {
        throw new Error("Community API returned invalid histogram buckets");
      }
      let previous = -1;
      let players = 0;
      for (const value of buckets) {
        const bucket = requireObject(value);
        if (typeof bucket.value !== "number" || !Number.isFinite(bucket.value) ||
          bucket.value < 0 || bucket.value > Number.MAX_SAFE_INTEGER || bucket.value <= previous ||
          !Number.isSafeInteger(bucket.count) || (bucket.count as number) <= 0) {
          throw new Error("Community API returned an invalid histogram bucket");
        }
        previous = bucket.value;
        players += bucket.count as number;
      }
      if (players !== data.players) {
        throw new Error("Community API returned inconsistent histogram counts");
      }
    }
    return value as PuzzleHistograms;
  }

  async submitScores(puzzleId: string, scores: PuzzleScores): Promise<void> {
    const submission: ScoreSubmission = {
      installationId: this.installationId,
      puzzleId,
      puzzleRevision: await this.revision(puzzleId),
      scoringVersion: API_SCORING_VERSION,
      scores,
    };
    const result = requireObject(await this.request("/v1/scores", submission));
    if (result.ok !== true) {
      throw new Error("Community API did not acknowledge the score");
    }
  }

  async publishPuzzle(puzzle: unknown): Promise<string> {
    const result = requireObject(await this.request("/v1/puzzles", {
      installationId: this.installationId,
      puzzle,
    }));
    if (typeof result.id !== "string" || !/^[a-f0-9]{64}$/.test(result.id)) {
      throw new Error("Community API returned an invalid shared puzzle ID");
    }
    const receipt = result as unknown as SharedPuzzleReceipt;
    return `${this.baseUrl}/v1/puzzles/${receipt.id}`;
  }

  private revision(puzzleId: string): Promise<string> {
    let revision = this.revisions.get(puzzleId);
    if (revision === undefined) {
      revision = crypto.subtle.digest("SHA-256", new TextEncoder().encode(serializeShippedPuzzle(puzzleId)))
        .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
      this.revisions.set(puzzleId, revision);
    }
    return revision;
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      credentials: "omit",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Community request failed (HTTP ${response.status})`);
    }
    return response.json();
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Community API returned an invalid response");
  }
  return value as Record<string, unknown>;
}
