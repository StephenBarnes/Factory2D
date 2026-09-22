# Community API and backend reference

For browser/server integration, HTTP contracts, trust boundaries, and local backend development. See [UI/lifecycle](ui-lifecycle.md) for workshop sessions and local persistence, and [deployment](deployment.md) for production configuration, hosting, backups, and releases.

## Architecture

The browser game remains a static Vite application; `backend/worker.ts` is a separately deployed Cloudflare Worker with a D1 binding named `DB`. D1 stores both score minima and bounded puzzle JSON; R2 is unnecessary until larger assets such as images or replays are needed. There are no account credentials in the browser bundle.

## Browser integration

`src/game/community-api.ts` defines the versioned wire contracts. `CommunityClient` owns HTTP requests and cached shipped-puzzle SHA-256 revisions. `CommunityScoresView` loads histograms on briefings and after submission attempts, displays connection/player-count status, and ignores superseded responses. Local all-case success is persisted before any network work; failed/manual runs never submit. Each successful submission merges the current result with each metric's minimum across previously confirmed saved solutions for that puzzle, including the active solution's prior result. This uploads better saved results even if their earlier submission failed or they were imported; combined remains the best actual combined score, not the sum of independent minima. The current solution retains its own scores locally and its result-chart markers always use that actual run, never the merged submission. Requests time out after ten seconds. There is no background retry queue or startup upload of historical saves: another successful test run retries a failed submission. Unset/blank `VITE_COMMUNITY_API_URL` disables community requests and sharing without disabling local play or personal-best summaries.

`src/game/score-histogram.ts` derives independent saved-score minima, exact player-weighted ranks, and 12 equal-width display buckets spanning the cohort and local markers (one bucket when all values coincide). Display buckets never affect percentiles or add players. Percentile is `100 × (players with score >= yours) / players`: lower scores win, ties share rank, and the best submitted score has percentile 100. Mineral thresholds are Mithril ≥75, Gold ≥50, Iron ≥25, otherwise Coal. Cohorts under ten players are labelled provisional; empty/unavailable cohorts have no rank. `src/ui/score-histograms.ts` renders shared dependency-free DOM/CSS charts for briefings and success reports, with two-decimal bucket bounds and exact counts available through hover, click/tap, and keyboard navigation. Rounded bounds are marked approximate; calculations retain full precision. The global best appears in the local-best value's tooltip and is evidence of an achieved score, not proof of theoretical optimality. See [UI/lifecycle](ui-lifecycle.md#puzzles-authoring-and-completion) for local-best marker ownership.

`CommunityClient` persists validated histogram responses in `factory2d.community-histograms:<encoded-api-url>:<encoded-puzzle-id>` localStorage entries. Cache reads reuse wire validation and reject mismatched puzzle revisions or scoring versions; corrupt/unreadable entries are cache misses. Cache write failures do not discard a successful live response. The main menu ranks the best currently confirmed local combined score against this last loaded cohort without making requests, including after reload. Briefings and success reports still fetch fresh cohorts, updating the cache for subsequent menu visits. Missing/empty caches and disabled community integration leave completed cards unranked. These derived entries participate in ordinary player-data export/import/clear.

## Trust and data ownership

The service intentionally trusts clients. Installation IDs are pseudonymous identifiers, **not authentication**; scores are structurally validated, not re-simulated, and submitted puzzle IDs/revisions are not checked against a server-side shipped registry. Public CORS permits every origin, including iframe origins, without credentials/cookies. It is not an anti-abuse boundary. Server schema changes use numbered SQL migrations in `backend/migrations/`; retain old migration files and add new ones. The schema and accepted HTTP API version are distinct from scoring version.

## HTTP contracts

All write requests use `Content-Type: application/json`. Bodies are capped at 1 MiB of UTF-8 bytes, including the wrapper; streaming bodies have the same cap. Invalid requests get JSON `{ error: string }` with HTTP 400, 404, 405, 413, or 415. Unexpected failures return generic 500 responses, with details only in Worker logs. No installation IDs are returned in public responses.

* `POST /v1/scores`: `{ installationId, puzzleId, puzzleRevision, scoringVersion: 1, scores: { price, cycles, footprint, combined } }`; returns `{ ok: true }`. `puzzleRevision` is lowercase SHA-256 of the exact `serializeShippedPuzzle` JSON. The atomic upsert stores each metric's minimum independently, keyed by puzzle ID, revision, scoring version, and installation UUID. Repeated/concurrent submissions never add another player. Combined is the minimum of submitted combined scores, not the sum of the other stored minima. Submission validation permits `combined >= price + cycles + footprint` because the independent minima may come from different solutions; individual local solution records still require equality. These are best-ever submitted scores; deleting/editing local solutions does not erase them.
* `GET /v1/puzzles/:puzzleId/histograms?revision=<sha256>&scoringVersion=1`: returns `{ puzzleId, puzzleRevision, scoringVersion, players, metrics }`, where each of `price`, `cycles`, `footprint`, and `combined` in `metrics` is an ascending array of `{ value, count }`. These are exact frequencies, retaining fractional mean cycles, not display bins or percentiles. Each installation contributes once per metric. An empty cohort returns zero players and empty arrays. All metrics use one database snapshot. Deriving counts from current minima avoids separate decrement/increment bookkeeping.
* `POST /v1/puzzles`: `{ installationId, puzzle }`; returns `{ id }`. The existing `parsePuzzleFile` validates the entire authored puzzle, including cases and victory blocks. The ID is SHA-256 of `JSON.stringify(puzzle)`, preserving property order; identical payloads are idempotent. Published copies are immutable; edits produce a new link.
* `GET /v1/puzzles/:id`: downloads the original puzzle JSON with an attachment filename. The sandbox's **EXPORT → SHARE PUZZLE** validates locally, asks for public-publication confirmation, then displays this URL. Recipients can download/import it into a sandbox. Community browsing, normal solution-mode play of shared puzzles, and voting remain separate roadmap items.

`API_SCORING_VERSION` is also the saved-solution scoring version: bump it when score semantics change to invalidate local confirmations and separate remote cohorts. Shipped puzzle-content changes automatically produce a different remote revision. HTTP routes stay under `/v1` until their contract changes.

## Local development

Install with `npm install`. No Cloudflare login is needed for local Workers/D1:

```sh
npm run db:migrate:local
npm run dev:backend
```

In another terminal:

```sh
VITE_COMMUNITY_API_URL=http://localhost:8787 npm run dev
```

Alternatively put the public endpoint in `.env.local` using `.env.example` as a guide. Vite reads it at startup/build time; restart Vite after changing it. Local Worker/D1 state lives under `backend/.wrangler/` and is ignored by Git. `npm run build` checks both browser and Worker TypeScript and builds only the static game into `dist/`. `npx wrangler deploy --config backend/wrangler.jsonc --dry-run` separately checks the Worker bundle without creating remote resources.
