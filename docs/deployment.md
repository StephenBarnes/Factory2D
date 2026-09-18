# Deployment and releases

For building and hosting the static game, deploying the optional Cloudflare backend, and recovering its database. See [community backend](community-backend.md) for HTTP contracts, trust boundaries, and local Worker/D1 development; see [UI/lifecycle](ui-lifecycle.md) for routing and player-data behavior.

## Deployment boundaries

The browser game and community backend are independent deployments:

* `npm run build` checks browser and Worker TypeScript, then builds only the static game into `dist/`.
* `npm run deploy:backend` publishes the Worker configured in `backend/wrangler.jsonc`; it does not rebuild the game or apply database migrations.
* `npm run db:migrate:remote` applies D1 migrations; building or uploading the game does not touch the database.

Run commands from the repository root after `npm install`. For local backend setup, see [local development](community-backend.md#local-development). `npx wrangler deploy --config backend/wrangler.jsonc --dry-run` checks the Worker bundle without creating remote resources.

## Public endpoint configuration

`VITE_COMMUNITY_API_URL` is a public API base URL, without `/v1`. Vite reads it at startup/build time, so restart the development server or rebuild after changing it. Never put credentials in `VITE_` variables: these values are embedded in browser JavaScript.

* Development is opt-in through an environment variable or ignored `.env.local`; `.env.example` shows the local Worker URL.
* Production defaults to the endpoint in `.env.production`. Override it with an environment variable or ignored `.env.production.local` for your own service.
* Unset/blank configuration disables community requests and puzzle sharing, not local play. Because this repository supplies a production default, explicitly override it with a blank value for an offline release:

```sh
VITE_COMMUNITY_API_URL= npm run build
# Or build the offline itch.io ZIP:
VITE_COMMUNITY_API_URL= npm run package:itch
```

### Repository-specific configuration

The checked-in `.env.production` points to `https://factory2d-community.factory2d.workers.dev`. `backend/wrangler.jsonc` contains the project's deployed D1 database UUID, **not a local placeholder**. These identifiers are configuration, not secrets. An independent deployment must use its own database and endpoint (or disable community features); it should not inherit the upstream service by accident.

Project publication status and the current itch.io page are tracked in [AGENTS.md](../AGENTS.md). The setup instructions below apply to new deployments as well as future releases; they are not outstanding setup tasks for that page.

## Cloudflare backend

### First deployment to your own account

Start with the Workers Free plan; check current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) before provisioning. Monitor request, CPU, row-read/write, and storage usage in the dashboard; large authored puzzles can hit CPU limits before request quotas. D1 stores both scores and bounded puzzle JSON. R2 is not enabled or required; larger assets such as images or replays would be a separate storage decision.

The following commands create or modify remote resources, unlike local verification:

1. Log in to the intended Cloudflare account:

   ```sh
   npx wrangler login
   ```

2. Choose a Worker `name` in `backend/wrangler.jsonc` and a database name for your deployment. This example uses `factory2d-community`; substitute your chosen database name if different:

   ```sh
   npx wrangler d1 create factory2d-community --config backend/wrangler.jsonc --update-config=false
   ```

3. Set `database_name` and `database_id` in `backend/wrangler.jsonc` to the created database's name and UUID. Retain the `DB` binding and `migrations_dir`. Verify these settings and the active account before running remote migrations.
4. Apply migrations and deploy:

   ```sh
   npm run db:migrate:remote
   npm run deploy:backend
   ```

5. Set `VITE_COMMUNITY_API_URL` to the full HTTPS `workers.dev` URL printed by Wrangler, including the Worker name and account subdomain. Do not use the bare account subdomain or append `/v1`. Rebuild the game and deploy `dist/` to the static host separately.

Cloudflare API tokens belong only in the deployment environment, never in `VITE_` variables, exported player data, or committed files. Wrangler OAuth is sufficient for interactive deployment; MCP servers are optional tooling, not a runtime dependency.

### Updating an existing backend

Retain numbered SQL migrations in `backend/migrations/` and add new ones rather than editing applied migrations. Before a schema change, take a backup as below and coordinate the migration with the Worker revision. Apply remote migrations, then deploy the compatible Worker. If a change cannot safely coexist with the running revision, stop writes for the transition. See [HTTP contracts](community-backend.md#http-contracts) for API/scoring-version boundaries.

### Backups and manual rollback

Before a remote schema change, record a D1 bookmark and keep an exported backup outside the repository. Replace `/safe/backup/factory2d.sql` with your backup location:

```sh
npx wrangler d1 time-travel info DB --config backend/wrangler.jsonc
npx wrangler d1 export DB --remote --output /safe/backup/factory2d.sql --config backend/wrangler.jsonc
```

For a deliberate rollback, coordinate the Worker revision with the schema, stop writes, and run:

```sh
npx wrangler d1 time-travel restore DB --bookmark <saved-bookmark> --config backend/wrangler.jsonc
```

Restore overwrites the entire database, including scores/puzzles added since that bookmark; do not run it casually. Check the current [Time Travel retention window](https://developers.cloudflare.com/d1/reference/time-travel/) for your plan. For longer retention keep SQL exports. Wrangler tracks applied [migrations](https://developers.cloudflare.com/d1/reference/migrations/) in `d1_migrations`; do not edit already-applied migrations to simulate a rollback.

## Static hosting

Build with `npm run build` and upload the contents of `dist/` to an HTTPS static host. The game uses hash routes and Vite's relative asset base (`./`), so the built files work unchanged in a subdirectory. Refreshing a saved workshop requests the same `index.html`, not an application-route file; no SPA fallback is needed. Opening `index.html` directly as a `file:` URL is unsupported; localhost is suitable for development.

The optional API is host-independent: an HTTPS endpoint plus public CORS works with itch.io, GitHub Pages, and a personal website, without cross-site cookies. Saves and the installation UUID belong to browser storage, not the physical machine. Different hosts/profiles get separate data unless full player data is transferred; restrictive storage settings can also affect embedded games. Recommend **Settings → Download Player Data** for backups/transfers. Browser-level site-data deletion can erase the UUID; the game's clear button preserves it.

## itch.io releases

### Package the game

With Node/npm dependencies installed and Python 3 available, configure the intended production endpoint (or offline override) and run:

```sh
npm run package:itch
```

This type-checks browser and Worker code, builds `dist/`, then uses Python's standard-library ZIP support to overwrite `release/factory2d-itch.zip`. Only built files are included, with `index.html` at the archive root and relative `assets/` JavaScript/CSS. Tile art and Web Audio effects are procedural; there are no separate image, font, or audio downloads. The Worker, database, source files, and environment files are not uploaded; only the public API URL is embedded in JavaScript. `release/` is ignored by Git.

### Set up a new project page

These are reusable initial settings, not steps to repeat on every release:

1. Select **HTML Game** as the project kind and upload `release/factory2d-itch.zip`. Mark the upload as **This file will be played in the browser**.
2. Prefer **Click to launch in fullscreen** for workshop space; alternatively embed at 1280×800 with the fullscreen button enabled. Keep **Click to Play** enabled. Leave **Mobile Friendly** unchecked while controls require mouse/keyboard.
3. Save as a draft and preview before choosing to publish. Explain that saves live in the browser and recommend player-data downloads for backups/transfers.

See [itch.io's HTML5 guide](https://itch.io/docs/creators/html5) for current upload limits and embed settings. A single HTML upload is not appropriate for this build: it also needs the bundled JavaScript and CSS.

### Update and verify a release

Upload the newly built ZIP to the existing page, select it as the browser-playable file, and remove the superseded upload. Existing page settings do not need to be recreated.

Verify on the actual host/preview, including its iframe and fullscreen mode where applicable:

* Puzzle/sandbox navigation, editing, reload, and Back/Forward.
* Sound after a user interaction and scene/player-data downloads.
* Community score status with the intended API, or local play without requests for an offline build.

Local static-server or cross-origin iframe checks are useful preflight checks, but do not replace host-specific verification. Publication is a separate choice from uploading a new build; keep draft/private visibility when that is intended.
