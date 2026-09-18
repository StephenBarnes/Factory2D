# Dwarfworks / Factory 2D

## Concept and direction

A Zachtronics-like puzzle game about building 2D machines from square tiles, similar to Infinifactory in side view. Adjacent blocks may be welded into rigid bodies. Physics advances in discrete ticks and grid-cell movements, with 90-degree rotations; unsupported blocks fall. Signed-ternary circuits and stateful components control the machinery. Rendering animates committed steps without affecting simulation.

Players choose a puzzle, read its briefing, and build within its editable region. Fixed machinery supplies inputs and checks products or signals; circuitry triggers victory. Solutions must pass every test case and are scored by component price, cycles, footprint, and a combined score. The sandbox supports unrestricted building and puzzle authoring.

The theme is dwarven engineering: lodestones, glowing runes, mineral processing, beer bottling, and machines for fighting elves. Future puzzles may involve sorting, assembly, mining vehicles, and mechanical or circuit computation. Roadmap in `docs/todos.md`.

## Stack and development state

* Strict TypeScript, framework-free HTML/CSS, direct Canvas 2D rendering, and Vite.
* Vitest (Node) for deterministic simulation and model tests; Playwright for browser workflows.
* Procedural tile graphics shared by the board, previews, and palette. Tile metadata lives in `src/simulation/tile.ts`.
* Implemented simulation includes gravity, welded bodies, magnets, conveyors, pistons, rotators, welders/splitters, furnaces, duplicators, delivery boxes, assemblers, ternary circuits, configurable sequential runes, and recursively nested rune arrays.
* The workshop supports placement/welding, selection transforms, snippets, component configuration, annotations, nested-array editing, signal traces, and scene/puzzle JSON plus PNG export.
* Hash-routed menus and briefings lead to independently saved solutions and sandboxes. Puzzle progression, all-case verification, scoring, authoring, and player-data import/export work locally. An optional Cloudflare Workers + D1 backend accepts successful scores, returns per-installation-best histogram data, and publishes downloadable puzzle files. Community browsing/solving, voting, histogram charts/ranks, and GIF export are not implemented. Relative production assets and `npm run package:itch` support static-host/itch.io ZIP releases; uploading and host-specific verification remain separate steps.
* The game is currently published as a draft at `https://stephen6174.itch.io/dwarfworks`, not publicly visible. Feel free to delete all saved player data or change schema whenever necessary. We are still in early development; backwards compatibility is not required.

## Task-specific references

Read the relevant reference before changing its subsystem; most tasks need only one or two. These describe current architecture and important contracts, not a feature-by-feature changelog. Source and tests define exact behavior.

| Task | Reference |
| --- | --- |
| Physics, circuits, components, nested boards, board serialization | `docs/simulation.md` |
| Tile appearance, Canvas rendering, animation, camera, visual performance | `docs/rendering.md` |
| Controls, tools, dialogs, navigation, persistence, puzzle authoring/testing | `docs/ui-lifecycle.md` |
| Community integration, HTTP API, backend trust boundaries, local Worker/D1 development | `docs/community-backend.md` |
| Production configuration, Cloudflare operations, static hosting, itch.io releases | `docs/deployment.md` |
| Planned features and priorities | `docs/todos.md` |
| Current puzzles and ideas for more puzzles | `docs/puzzles.md` |
| Performance investigations and proposed optimizations | `docs/performance-todos.md` |

Update the relevant reference when changing architecture or a durable contract.

## Cross-cutting invariants

* Simulation is deterministic: observe start-of-tick state, collect and resolve intents, then commit. Equal-priority competing intents jam rather than depend on iteration order. Rendering never feeds interpolated positions back into physics.
* `World` separates tile kinds from stable nonzero tile IDs; empty cells have ID 0. Stateful components must survive movement, cloning, reset, transforms, duplication, and serialization consistently.
* A session's `world`/`simulation`, editable `baseline`, and render-only `previousWorld` have distinct ownership. Simulation never writes back to the baseline. `WorkshopSurfaceController` binds active world/view references together, including nested views.
* Puzzle edits must respect editable regions and component availability. Simulation locks puzzle editing until reset, but not sandbox editing. Only a successful complete test run records puzzle completion.

## Development guidelines

Keep the simulation deterministic and independent of rendering. Some information (e.g. list of connected bodies) can be shared. Write tests for simulation behavior.

Handle unexpected undefineds loudly. When a lookup is logically guaranteed to succeed (e.g. checked indexed access under `noUncheckedIndexedAccess`), narrow it with `expectDefined` from `src/util/assert.ts` rather than a silent fallback (`?? default`, guarded `break`/`continue`). We want violated expectations to crash with a descriptive message during development, never to continue silently with wrong state. Reserve explicit fallbacks for cases where absence is genuinely valid.

Prefer a new focused file for a new concern.

For performance, target one screen of blocks, 400x300 tiles at most, on low-end hardware, animated at 60 FPS, with 5 sim ticks per second.

No legacy compatibility is required. We are in early development. Make clean cutovers and remove obsolete code.

After completing changes, commit them to `master` or the current worktree. Self-contained commits are preferred.

## Build and verification

* `npm install` installs dependencies.
* `npx playwright install chromium` installs the browser binary used by the Playwright suite when no system Chromium path is configured.
* `npm run dev` starts the Vite development server.
* `npm run build` type-checks TypeScript and creates the production bundle in `dist/`.
* `npm test` runs the deterministic simulation tests once.
* `npm run test:browser` runs the Playwright lifecycle suite once.
* `npm run test:watch` runs tests in watch mode.
