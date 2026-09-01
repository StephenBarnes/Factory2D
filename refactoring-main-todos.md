Looking through `src/main.ts` for refactoring opportunities.

## Recommended TODOs

### 1. Commit drag edits once per pointer gesture

**TODO:** Refactor tile and weld drags into edit transactions that update the live world continuously but save the baseline and persist the solution only once when the gesture finishes.

**Why this is highest value:**

- `pointermove` repeatedly calls `editCellLine` and `editWeldSegment` (`src/main.ts:1494-1512`).
- Those functions call `saveEditedBaseline()` after every changed segment (`src/main.ts:816-818`, `934-936`).
- `saveEditedBaseline()` copies the world into the baseline and then calls `finishAnimation()`, which copies it again into `previousWorld` (`src/main.ts:383-385`, `724-728`; `src/game/workshop-session.ts:116-129`).
- On a 400×300 board, a long drag can therefore perform multiple full-board copies per pointer event.

**Suggested shape:**

- Make `editCellLine`, `editWeld`, and `editWeldSegment` return whether they changed the world.
- Accumulate that result in gesture state.
- On both `pointerup` and `pointercancel`, call one shared `commitEditedWorld()` if anything changed.
- Keep configuration, clear, delete, and selection commit as immediate one-operation transactions.
- Ensure navigation/session changes finalize or cancel any active transaction explicitly.

**Check:** A multi-event tile or weld drag should update every crossed cell/edge while invoking baseline synchronization and persistence exactly once.

---

### 2. Centralize active-workshop mounting

**TODO:** Add a focused workshop-surface controller that atomically binds the active session’s world, simulation, previous world, renderer, selection state, inspector, and hover state.

**Current risk:**

`activeSession`, `world`, `simulation`, and `previousWorld` are parallel mutable aliases (`src/main.ts:84-90`). `loadActiveWorkshopSession()` manually refreshes those aliases and reconstructs several dependent objects (`src/main.ts:273-290`).

Every runtime replacement must then remember a repeated protocol:

1. Change the session/runtime.
2. Call `loadActiveWorkshopSession()`.
3. Fit the renderer.
4. Synchronize test-case controls or overlays.
5. Refresh hover and transport state.

That sequence is repeated for viewing a case, starting a test, fast-forwarding, resetting, importing, and navigation (`src/main.ts:364-379`, `1130-1139`, `1188-1194`, `1220-1241`, `1373-1377`). Missing one step can leave the renderer, inspector, selection, or simulation pointing at different worlds.

**Suggested shape:**

- A concrete `WorkshopSurfaceController`, not a generic application framework.
- One `mountActiveSession({ fitBoard, cancelInteraction })` operation.
- It owns the session-bound renderer, selection, inspector, and cached world references.
- Session/runtime replacement callsites cannot access stale bindings.
- Mounting also cancels an active pointer gesture before changing worlds.

**Check:** Importing, selecting a test case, beginning the next test case, resetting, and returning to an existing workshop should all use the same mounting path.

---

### 3. Extract puzzle-test presentation and lifecycle control

**TODO:** Move puzzle test-case selection, visible execution, transitions, fast-forwarding, failure presentation, and report presentation into a `PuzzleTestController`.

**Why:**

Puzzle-test orchestration is currently spread across several distant sections:

- Mutable state at `src/main.ts:176-180`.
- Case selector management at `292-380`.
- Test start/mount/finish and fast-forward at `1130-1195`.
- Reset interaction at `1212-1242`.
- Timed visible execution at `1804-1849`.

The lifecycle is represented by overlapping values:

- `testingPuzzleSolution`
- `activePuzzleTestRun`
- `activePuzzleTestRun.status`
- `viewedPuzzleTestCaseId`
- `nextPuzzleTestCaseAt`

Those values admit invalid combinations even though existing callsites try to maintain them correctly.

**Suggested shape:**

- Retain `PuzzleTestRun` as the simulation/domain object.
- Add a UI/application controller around it with an explicit tagged lifecycle, such as:
  - `idle`
  - `viewing-case`
  - `running`
  - `between-cases`
  - `failed`
  - `succeeded`
- Public operations should be narrow: `showCase`, `start`, `advanceFrame`, `fastForward`, `reset`, and `stop`.
- The controller should own the case dropup, status toast, report dialog, timing fields, and mounting of case runtimes.
- `main.ts` should only delegate button events and animation-frame time.

**Check:** Cover visible case transitions, fast-forward success, cycle-limit failure, simulation failure, reset, and stopping due to navigation with controller-level tests.

---

### 4. Encapsulate the canvas pointer state machine

**TODO:** Extract canvas pointer handling into a `CanvasInteractionController` that owns pointer capture and all active-gesture state.

**Why:**

The pointer lifecycle currently depends on a large tuple of module-level mutable fields (`src/main.ts:187-200`), while the handlers span `src/main.ts:1386-1603`. Examples include:

- Pointer ID and gesture mode
- Tool captured at pointer-down
- Erase and weld-placement flags
- Pending pick and configuration cells
- Last grid point and edited cell
- Pan coordinates

The invariant tying these together is enforced only by runtime checks such as the one at `src/main.ts:1490-1492`. `stopWorkshopActivity()` does not explicitly clear or cancel this pointer state, making navigation or runtime replacement during a captured gesture particularly fragile.

**Suggested shape:**

- Own pointer-down/move/up/cancel state privately.
- Capture the active tool and session binding at gesture start.
- Emit concrete operations through a small callback interface: edit cells, edit welds, update selection, update authoring rectangle, pan, pick, open configuration, and commit edit transaction.
- Provide an explicit `cancel()` called before session/runtime switches.
- Keep keyboard shortcuts separate; avoid creating a catch-all input manager.

**Check:** Test pointer cancellation, leaving and re-entering the grid, pick-versus-pan threshold behavior, tool changes during a gesture, session changes during capture, and one-time edit commits.

## Not worth standalone TODOs

I would not add separate refactors merely for:

- Grouping the many DOM lookups.
- Replacing the tool-selection `if` chains with a generic registry.
- Extracting import/export handlers solely to shorten the file.
- Wrapping everything in one large `App` class.
- Converting the animation frame into a generic scheduler.

Those mostly relocate straightforward code. The four items above address measurable copy cost, lifecycle invariants, invalid state combinations, and difficult-to-test interaction behavior. After them, `main.ts` should naturally shrink into composition, event wiring, and the render loop.