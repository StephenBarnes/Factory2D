import type { D1Database } from "@cloudflare/workers-types";
import {
  API_SCORING_VERSION,
  type PuzzleHistograms,
  type ScoreHistogramBucket,
  type ScoreMetric,
  type SharedPuzzleReceipt,
} from "../src/game/community-api";
import { isInstallationId } from "../src/game/installation-id";
import { parsePuzzleFile, PUZZLE_ID_PATTERN } from "../src/game/puzzle-format";
import { parsePuzzleScores } from "../src/game/puzzle-scores";
import { expectDefined } from "../src/util/assert";

interface Env {
  readonly DB: D1Database;
}

const MAX_JSON_BYTES = 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers?: HeadersInit,
  ) {
    super(message);
  }
}

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

/** Count streamed bytes rather than trusting Content-Length or buffering an unbounded body. */
async function readJson(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new HttpError(400, "Content-Length must be a non-negative integer");
    }
    if (Number(contentLength) > MAX_JSON_BYTES) {
      throw new HttpError(413, "JSON request body must not exceed 1 MiB");
    }
  }
  if (!request.body) throw new HttpError(400, "A JSON request body is required");

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  let complete = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        complete = true;
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_JSON_BYTES) {
        throw new HttpError(413, "JSON request body must not exceed 1 MiB");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Request body must be readable UTF-8 JSON");
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

function requireObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be an object");
  }
  const record = value as Record<string, unknown>;
  for (const field of fields) {
    if (!Object.hasOwn(record, field)) throw new HttpError(400, `Missing field: ${field}`);
  }
  for (const field of Object.keys(record)) {
    if (!fields.includes(field)) throw new HttpError(400, `Unknown field: ${field}`);
  }
  return record;
}

function requireInstallationId(value: unknown): string {
  if (!isInstallationId(value)) throw new HttpError(400, "installationId must be a lowercase UUID v4");
  return value;
}

function requirePuzzleId(value: unknown): string {
  if (typeof value !== "string" || !PUZZLE_ID_PATTERN.test(value)) {
    throw new HttpError(400, "puzzleId must contain lowercase letters, digits, and single hyphens only");
  }
  return value;
}

function requireHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new HttpError(400, `${field} must be a 64-character lowercase SHA-256 hex hash`);
  }
  return value;
}

function requireVersion(value: unknown): typeof API_SCORING_VERSION {
  if (value !== API_SCORING_VERSION) {
    throw new HttpError(400, `scoringVersion must be ${API_SCORING_VERSION}`);
  }
  return value;
}

function requireQuery(url: URL, fields: readonly string[]): void {
  for (const field of url.searchParams.keys()) {
    if (!fields.includes(field)) throw new HttpError(400, `Unknown query parameter: ${field}`);
  }
  for (const field of fields) {
    if (url.searchParams.getAll(field).length !== 1) {
      throw new HttpError(400, `Query parameter ${field} is required exactly once`);
    }
  }
}

function requireMethod(request: Request, method: string): void {
  if (request.method !== method) {
    throw new HttpError(405, `Use ${method} for this endpoint`, { Allow: `${method}, OPTIONS` });
  }
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "Path contains invalid percent encoding");
  }
}

async function submitScores(request: Request, db: D1Database): Promise<Response> {
  const body = requireObject(await readJson(request), [
    "installationId", "puzzleId", "puzzleRevision", "scoringVersion", "scores",
  ]);
  const installationId = requireInstallationId(body.installationId);
  const puzzleId = requirePuzzleId(body.puzzleId);
  const puzzleRevision = requireHash(body.puzzleRevision, "puzzleRevision");
  const scoringVersion = requireVersion(body.scoringVersion);
  let scores;
  try {
    scores = parsePuzzleScores(body.scores, "Submitted", "independent-minima");
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid scores");
  }

  // One atomic statement also handles simultaneous submissions for an installation.
  await db.prepare(`
    INSERT INTO score_bests (
      puzzle_id, puzzle_revision, scoring_version, installation_id,
      price, cycles, footprint, combined
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (puzzle_id, puzzle_revision, scoring_version, installation_id)
    DO UPDATE SET
      price = MIN(score_bests.price, excluded.price),
      cycles = MIN(score_bests.cycles, excluded.cycles),
      footprint = MIN(score_bests.footprint, excluded.footprint),
      combined = MIN(score_bests.combined, excluded.combined)
  `).bind(
    puzzleId, puzzleRevision, scoringVersion, installationId,
    scores.price, scores.cycles, scores.footprint, scores.combined,
  ).run();
  return json({ ok: true });
}

async function histograms(url: URL, puzzleId: string, db: D1Database): Promise<Response> {
  requireQuery(url, ["revision", "scoringVersion"]);
  const puzzleRevision = requireHash(url.searchParams.get("revision"), "revision");
  if (url.searchParams.get("scoringVersion") !== String(API_SCORING_VERSION)) {
    throw new HttpError(400, `scoringVersion must be ${API_SCORING_VERSION}`);
  }
  const scoringVersion = API_SCORING_VERSION;
  // All four metrics come from one SQL snapshot; every cohort row is one player.
  const result = await db.prepare(`
    WITH cohort AS (
      SELECT price, cycles, footprint, combined FROM score_bests
      WHERE puzzle_id = ? AND puzzle_revision = ? AND scoring_version = ?
    )
    SELECT 'price' AS metric, price AS value, COUNT(*) AS count FROM cohort GROUP BY price
    UNION ALL
    SELECT 'cycles', cycles, COUNT(*) FROM cohort GROUP BY cycles
    UNION ALL
    SELECT 'footprint', footprint, COUNT(*) FROM cohort GROUP BY footprint
    UNION ALL
    SELECT 'combined', combined, COUNT(*) FROM cohort GROUP BY combined
    ORDER BY metric, value
  `).bind(puzzleId, puzzleRevision, scoringVersion).all<{
    metric: ScoreMetric;
    value: number;
    count: number;
  }>();
  const metrics: Record<ScoreMetric, ScoreHistogramBucket[]> = {
    price: [], cycles: [], footprint: [], combined: [],
  };
  let players = 0;
  for (const row of result.results) {
    metrics[row.metric].push({ value: row.value, count: row.count });
    if (row.metric === "price") players += row.count;
  }
  const response: PuzzleHistograms = { puzzleId, puzzleRevision, scoringVersion, players, metrics };
  return json(response);
}

async function publishPuzzle(request: Request, db: D1Database): Promise<Response> {
  const body = requireObject(await readJson(request), ["installationId", "puzzle"]);
  const installationId = requireInstallationId(body.installationId);
  try {
    parsePuzzleFile(body.puzzle, "Submitted puzzle");
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid puzzle");
  }
  // Preserve the validated file object, not the parser's allocated runtime worlds.
  const puzzleJson = JSON.stringify(body.puzzle);
  const bytes = new TextEncoder().encode(puzzleJson);
  if (bytes.byteLength > MAX_JSON_BYTES) {
    throw new HttpError(413, "Serialized puzzle must not exceed 1 MiB");
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await db.prepare(`
    INSERT INTO shared_puzzles (id, installation_id, puzzle_json) VALUES (?, ?, ?)
    ON CONFLICT (id) DO NOTHING
  `).bind(id, installationId, puzzleJson).run();
  const response: SharedPuzzleReceipt = { id };
  return json(response);
}

async function downloadPuzzle(id: string, db: D1Database): Promise<Response> {
  const row = await db.prepare("SELECT puzzle_json FROM shared_puzzles WHERE id = ?")
    .bind(id).first<{ puzzle_json: string }>();
  if (!row) throw new HttpError(404, "Shared puzzle not found");
  return new Response(row.puzzle_json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${id}.json"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  const url = new URL(request.url);
  if (url.pathname === "/v1/scores") {
    requireMethod(request, "POST");
    requireQuery(url, []);
    return submitScores(request, env.DB);
  }
  if (url.pathname === "/v1/puzzles") {
    requireMethod(request, "POST");
    requireQuery(url, []);
    return publishPuzzle(request, env.DB);
  }
  const histogramPath = /^\/v1\/puzzles\/([^/]+)\/histograms$/.exec(url.pathname);
  if (histogramPath) {
    requireMethod(request, "GET");
    const puzzleId = requirePuzzleId(decodePathPart(expectDefined(histogramPath[1], "Histogram route is missing its puzzle ID")));
    return histograms(url, puzzleId, env.DB);
  }
  const puzzlePath = /^\/v1\/puzzles\/([^/]+)$/.exec(url.pathname);
  if (puzzlePath) {
    requireMethod(request, "GET");
    requireQuery(url, []);
    const id = requireHash(decodePathPart(expectDefined(puzzlePath[1], "Download route is missing its content ID")), "Puzzle content ID");
    return downloadPuzzle(id, env.DB);
  }
  throw new HttpError(404, "Unknown API endpoint");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        response = json({ error: error.message }, error.status, error.headers);
      } else {
        console.error("Community API request failed", error);
        response = json({ error: "Internal server error" }, 500);
      }
    }
    // Public, trusted-client API: arbitrary static hosts and itch embeds, no cookies.
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type");
    response.headers.set("Access-Control-Expose-Headers", "Content-Disposition");
    return response;
  },
};
