The current setup is already unusually effective: `AGENTS.md` gives concrete invariants, the code map is accurate, failures are expected to be loud, and simulation behavior has strong deterministic tests. I would preserve those qualities.

The main friction is controlling and observing the browser application around it.

## Highest-impact recommendations

### 1. Split `src/main.ts` by lifecycle responsibility

`src/main.ts` is now roughly 1,200 lines and owns several independent systems:

- Screen routing
- Saved-solution persistence
- Workshop-session lifecycle
- Palette and tool selection
- Pointer and keyboard input
- Import/export
- Animation timing
- Rendering

The simulation code is already well-factored; the application controller is the remaining concentration point.

I would avoid a framework, event bus, or generic state-management layer. Extract only concrete concepts:

- `src/game/workshop-session.ts`
  - `GameSession`
  - Creation from a `World` or saved solution
  - Baseline/live/previous-world ownership
  - Simulation reset
- `src/app/navigation.ts`
  - Valid `AppScreen` transitions
  - Screen visibility
  - Main-menu and puzzle-info routing
- `src/app/solution-controller.ts`
  - Create, duplicate, open, dirty tracking, flush, and delete
- Keep input handling, rendering, and the animation loop in `main.ts`.

**Copyable TODO:**

> Split `src/main.ts` into focused workshop-session, navigation, and saved-solution controller modules. Keep `main.ts` as browser event wiring and the animation loop. Do not introduce a framework, event bus, dependency-injection system, or generic store.

### 2. Make every screen directly addressable

`INITIAL_SCREEN` is simple, but reaching a particular state requires UI navigation and existing local-storage state. URL-backed routing would improve manual testing, browser automation, bug reproduction, and eventual browser back-button behavior.

Suggested routes:

- `#/`
- `#/sandbox`
- `#/puzzles/first-shift`
- `#/puzzles/first-shift/solutions/solution-1`

Requirements:

- Invalid puzzle or solution IDs fail visibly or return to a defined screen.
- Locked puzzles remain inaccessible through direct routing.
- Browser Back and Forward restore screens without losing pending solution edits.
- Default development behavior can remain the sandbox until intentionally changed.

**Copyable TODO:**

> Add URL-backed application routing for the main menu, sandbox, puzzle briefing, and saved-solution workshop. Support browser Back/Forward, validate puzzle and solution IDs, enforce puzzle locking on direct routes, and preserve dirty solution edits during navigation.

### 3. Add a small browser-level regression suite

Vitest thoroughly covers simulation and storage models, but routing and solution management currently require manual browser verification. Those features depend on real DOM events, `localStorage`, reloads, and responsive CSS, so a Node DOM shim would provide limited confidence.

A minimal Playwright suite would be enough:

1. Open main menu and select an unlocked puzzle.
2. Confirm the briefing, objective, and features.
3. Create a solution.
4. Modify the board.
5. Return to the briefing.
6. Duplicate and delete solutions.
7. Reload and confirm the edited design remains.
8. Check desktop and narrow viewports for horizontal overflow.

Use accessible names and existing IDs first. Add `data-testid` only where semantic selectors are genuinely ambiguous.

**Copyable TODO:**

> Add a minimal Playwright browser suite covering puzzle-info routing, solution creation, board persistence, duplication, deletion, reload restoration, and narrow-screen overflow. Seed local storage deterministically and prefer accessible selectors over broad `data-testid` coverage.

### 4. Provide a development-only diagnostic snapshot

Canvas state is inherently opaque to browser automation. At present, inspecting a tile requires calculating screen coordinates and driving the hover inspector. A read-only diagnostic surface would make browser failures much easier to understand without adding a second control path.

For development builds only:

```ts
window.factory2dDebug.snapshot()
```

Potential result:

```ts
{
  screen,
  puzzleId,
  solutionId,
  running,
  tick,
  editable,
  selectedTool,
  selectedTileKind,
  hoveredCell,
  world: {
    width,
    height,
    revision,
    serializedBoard,
  },
}
```

I would keep this read-only. Mutation commands risk tests bypassing the real UI and validating the wrong path.

**Copyable TODO:**

> Add a development-only, read-only browser diagnostic snapshot exposing the current screen, active puzzle and solution, simulation state, selected tool, hovered cell, world revision, and serialized board. Do not expose mutation commands or include the API in production builds.

## Understanding-oriented improvements

### 5. Document application-state invariants

The simulation invariants are excellent. The browser lifecycle now needs an equally concise section. The important relationships are not immediately obvious:

- `world` is the current live simulation state.
- `baseline` is the editable design restored by Reset.
- `previousWorld` exists only for interpolation.
- Saved solutions store the baseline, never transient simulated state.
- A puzzle solution owns a workshop session.
- Entering simulation locks puzzle editing.
- Navigating away flushes dirty baseline changes.
- Puzzle completion is global progress, not solution identity.

This should be a short table in `AGENTS.md`, not a new architecture document.

**Copyable TODO:**

> Add an “Application lifecycle invariants” section to `AGENTS.md` documenting ownership and transitions for `AppScreen`, saved solutions, workshop sessions, `world`, `baseline`, `previousWorld`, simulation locking, dirty persistence, reset, and puzzle completion.

### 6. Prioritize the existing JSON puzzle-definition TODO

This remains the best content/system boundary improvement. Puzzle data currently mixes declarative content with TypeScript world-construction functions. A validated JSON format would make puzzle intent visible without reading imperative placement code.

Important details for that task:

- One strict runtime parser.
- One versioned schema.
- Compact board representation reused from board export where practical.
- Feature labels, descriptions, goals, prerequisites, component prices, editable regions, and initial board in the file.
- Parser errors identify the puzzle file and exact invalid field.
- No fallback defaults for required fields.
- Registry ordering remains explicit and deterministic.
- Tests load every shipped puzzle file.

**Suggested addition to the existing TODO:**

> Define a versioned, strictly validated puzzle JSON schema containing metadata, feature labels, prerequisites, component prices, editable regions, and initial board state. Load every shipped puzzle through the production parser in tests, with file- and field-specific validation errors.

## Smaller ergonomic improvements

### 7. Add deterministic browser fixtures

A few named fixtures would make reproduction much faster:

- Empty progress and no solutions
- First puzzle with one saved solution
- First puzzle with several solutions
- Completed first puzzle with Beltworks unlocked
- Corrupt saved-solution storage
- A solution with a recognizable tile at a known coordinate

These should seed the real persistence format rather than mock application internals.

**Copyable TODO:**

> Add deterministic browser fixtures for puzzle progress and saved solutions, including empty, populated, unlocked, edited-board, and malformed-storage states. Seed the real versioned local-storage formats used by production.

## What I would not change

- Do not move to React or another UI framework solely for ergonomics.
- Do not introduce Redux, an event bus, or a generic application store.
- Do not refactor the simulation architecture; its phases and tests are already easy to reason about.
- Do not add pervasive `data-testid` attributes when IDs, labels, roles, and visible names suffice.
- Do not expand `AGENTS.md` with implementation narration. Add invariants and keep the existing code map current.

If only three tasks are added, I would choose:

1. Split `src/main.ts` by concrete lifecycle responsibility.
2. Add URL-backed routing.
3. Add the small Playwright workflow suite.

Those would most improve my ability to navigate, inspect, modify, and verify the system without weakening its current simplicity.