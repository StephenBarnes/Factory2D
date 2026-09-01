Looking through `src/main.ts` for refactoring opportunities.

## Recommended TODOs

### 1. Commit drag edits once per pointer gesture — Completed

Tile and weld edit helpers now return whether they changed the live world. Pointer gesture state
accumulates that result, and `pointerup`, `pointercancel`, simulation starts, navigation, imports,
and runtime replacements finalize the active transaction through one `commitEditedWorld()` call.
Configuration, clear, delete, and selection commits remain immediate transactions.

**Check:** `e2e/app-lifecycle.spec.ts` covers live multi-event drag updates and verifies that both
pointer-up and pointer-cancel persistence happen exactly once per changed gesture.

---

### 2. Centralize active-workshop mounting — Completed

`WorkshopSurfaceController` now owns the active session, world, simulation, previous world,
renderer, selection, inspector, and hover bindings. `mountActiveSession()` cancels interaction
before an optional session mutation, rebuilds every bound view together, optionally fits the
board, and invokes one post-mount synchronization path.

**Check:** Navigation, imports, test-case selection and transitions, fast-forwarding, and reset
all mount through the controller. `tests/workshop-surface-controller.test.ts` verifies cancellation
ordering, atomic rebinding, fit behavior, and mount notifications.

---

### 3. Extract puzzle-test presentation and lifecycle control — Completed

`PuzzleTestController` now owns case selection, visible timing and transitions, fast-forwarding,
failure status, success reports, and case-runtime mounting around the existing `PuzzleTestRun`
domain object. One tagged lifecycle represents idle, viewing, running, between-case, failed, and
succeeded states; `main.ts` delegates controls and animation frames.

**Check:** `tests/puzzle-test-controller.test.ts` covers visible multi-case transitions,
fast-forward success, cycle-limit and simulation failures, reset, case selection, and navigation
stop.

---

### 4. Encapsulate the canvas pointer state machine — Completed

`CanvasInteractionController` now owns pointer capture and a discriminated active gesture that
captures its tool and workshop session at pointer-down. It handles edit, selection, authoring,
pick-versus-pan, finish, and cancellation paths through focused callbacks. Surface mounting,
simulation starts, navigation, imports, and page hide all cancel through the same operation.

**Check:** `tests/canvas-interaction-controller.test.ts` covers pointer cancellation, grid
leave/re-entry, pick-versus-pan behavior, mid-gesture tool changes, stale session capture, and
one-time transaction commits.

## Not worth standalone TODOs

I would not add separate refactors merely for:

- Grouping the many DOM lookups.
- Replacing the tool-selection `if` chains with a generic registry.
- Extracting import/export handlers solely to shorten the file.
- Wrapping everything in one large `App` class.
- Converting the animation frame into a generic scheduler.

Those mostly relocate straightforward code. The four items above address measurable copy cost, lifecycle invariants, invalid state combinations, and difficult-to-test interaction behavior. After them, `main.ts` should naturally shrink into composition, event wiring, and the render loop.