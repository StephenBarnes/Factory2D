# Factory 2D (working title)

## Concept

This is planned to be a game similar to a 2D Infinifactory. The game is a series of one-screen puzzles, where the player places square 2D tiles/blocks on a grid to accomplish some goal.

At each line between two non-empty blocks, they can be either welded together, or separate. Welded groups of blocks always move as one group. The simulation runs in discrete time steps, and blocks move in discrete one-block increments. Blocks can only rotate in 90-degree increments. Some blocks have internal state. Blocks have different types, like stone or sand or pistons or conveyor belts or wires. This is a side view, so unsupported blocks fall down one space every one time step. No continuous-time or continuous-space physics.

Planned game flow: We show a main menu. The player selects a puzzle, which defines the initial screen and constraints, e.g. inputs and outputs, fixed terrain, player-modifiable region. Player can select components; left click places, right click removes. They can also select a weld tool or a selection tool. With the weld tool, left click welds, right click unwelds. When placing, they can rotate the component in 90-degree increments. Later additional conveniences like placing lines/rectangles, bulk weld/unweld, selection and moving. Each puzzle defines fixed terrain, and which components are available, and prices for those components which are used to score solutions. The player presses a button to run/play the simulation and check behavior, with options to pause, step once, control speed, or reset to the state before running.

Implemented components:
* Solid blocks - can have downward gravity, diagonal gravity (sand), can be weldable on some sides, can be magnetic.
* Magnets - attract a block in the direction they're facing.

Planned components:
* Wire blocks which transmit voltage to other wire blocks welded to them. Voltage is a float, so signals can be transmitted.
* Furnace blocks that transform one neighbor cell into a different one after a delay: sand to glass, ore to metal.
* Conveyor belts apply a clockwise or counterclockwise force to their 4 neighbor blocks. A conveyor placed on a floor will try to roll in one direction, and try to push the platform in the other direction, unless it's welded onto the platform.
* Welders and splitters - weld or unweld the 3 blocks above them.
* Pistons - 1 block which expands to 2 blocks when given a signal, pushing things around.
* Sensors that emit a signal if they have a neighboring block in a certain direction. Sensors that detect pushing force from a direction.
* Electrical components like logic gates, delays, diodes, brush connectors.
* Assemblers that convert a group of blocks welded in a specific way into one block. For example iron and copper blocks welded in a specific way are converted to a piston block.
* Flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide/overlap other blocks.
* Laser splitter: splits everything in a line.
* Configurable components where the player can enter a number in a text box, e.g. a configurable-delay repeater.
* Component that rotates a neighboring block or body around itself.
* Circuit-board components with internal grids where mini-components can be placed to program their behavior.

More concepts:
* Furnaces could have special behavior if said neighbor is surrounded by certain other neighbors. Or they could trigger a block to weld to neighbors after cooking it. There could be stages, e.g. cookie dough -> cookie -> burnt cookie, creating timing challenges.
* Each puzzle could have several test cases, with different timing of inputs.
* Puzzles could include terrain that makes it harder to fit a solution, or pre-placed components like teleporters. The solution might require welding blocks together, but there's only one welder present on the map, so it must be reused in different ways.
* Puzzles could include a wire input that switches on/off, and the solution must sort blocks into left vs right outputs dependent on the wire's charge.
* We'll introduce components gradually, as puzzles are completed. Each puzzle has a limited set of components available.
* Puzzle inputs and outputs will be physically present on the map. A dispenser block dispenses ore, which must be smelted to iron, which is then delivered to a delivery block; level is beaten when the delivery block has received enough iron blocks. We wire up the dispenser to a timer circuit physically present in the level, or to a button that the player can press.
* We'll show a sidebar with all interactions relevant for a given puzzle.
* Shareable puzzles and solutions. Sandbox and puzzle editor. Exporting solutions as GIFs. Histogram screen to compare performance on each metric with other players.

Example puzzles:
* Given inputs, weld them together and use an assembler to make intermediates; then weld together those intermediates and use an assembler to make a final product.
* Sort blocks into bins based on physical properties.
* Build a 4-bit adder using wires and logic gates.
* Build a 4-bit adder without wires and logic gates, by pushing around blocks mechanically.
* Mob farms - mobs are dispensed by a hive and move around according to rules, must be herded to a destination.
* Depalletizing - dispenser gives a 5x5 group of welded iron blocks, which must be split up and transported to the delivery block.
* Build a vehicle that picks up a block in one location and moves it to the target.
* Tree farms - trees grow in irregular patterns; once grown high enough, their leaves must be burned off and their wood blocks unwelded and packaged for delivery.

While the simulation has movement in discrete time steps and one-tile steps, we animate the tiles moving.

## Stack

* Strict TypeScript targeting modern browsers.
* Framework-free HTML and CSS.
* Canvas 2D rendered directly.
* Vite for development server and production bundling.
* Vitest with the Node environment for simulation tests.
* Browser APIs for later audio and persistence: Web Audio API and localStorage/IndexedDB.

Tiles are drawn procedurally using Canvas 2D functions and colors defined on `TILE_DEFINITIONS`.

### Simulation conventions

We want simulation rules to be deterministic, consistent, and understandable/predictable.
We'll write many small tests that simulate scenarios and check behavior.
As a general rule, a component can only observe the state at the beginning of a cycle, and react to it by making a change that becomes visible at the end of the cycle. Nothing reacts instantly to something that happened in the same tick.

* A world stores compact tile kinds separately from stable, nonzero tile IDs. Empty cells have ID 0.
* Each tick has observation, intent resolution, and commit phases. Components only observe the start-of-tick state.
* Gravity moves an eligible body at most one cell per tick. World boundaries are solid.
* Competing intents at the same priority jam rather than depending on iteration order. Driven movement will outrank passive gravity. Pushing will resolve the complete dependency chain before any body moves.
* Rendering may interpolate committed steps, but interpolation never feeds back into simulation state.

The current engine implements observation, intent conflict resolution, and commit phases for straight-down and diagonal gravity. Welded and magnetically constrained bodies move as groups, and unsupported touching bodies resolve complete downward movement dependency chains before committing together. Driven movement, general-purpose pushing, and rotation remain future simulation work.

## Development state

Keep this section up-to-date.

The first playable scaffold is implemented:

* A 20x14 editable Canvas 2D grid with procedural sand, falling stone, magnetic metal, directional magnets, and fixed platform tiles.
* A responsive board canvas whose backing-store resolution follows browser zoom without contributing its intrinsic pixel dimensions to page layout.
* Build controls for gap-free click-and-drag placement and removal, including drags that leave the grid, plus magnet rotation and aiming, stepping, running, pausing, resetting, clearing, and speed selection.
* A separate weld tool for joining eligible occupied neighbors into rigid bodies and unwelding them, with gap-free fast-drag traversal, an immediate held-Control temporary override, and red invalid-edge feedback. Sand is not weldable, and magnets reject welds on their pointed side.
* One shared procedural tile renderer for the Canvas board, placement preview, and component palette. Palette previews use density-aware, supersampled backing stores and redraw when browser zoom or display density changes. Each welded body renders as a single rounded polyomino slab: a traced, inset outline path with convex corner rounding and concave weld fillets, a drop shadow, per-cell fills and decorations clipped to the outline, top-left highlight and bottom-right shade bevels, and a dark rim. Diagonally touching cells render as a rounded pinch, and unwelded edges interior to a body render as dark seam grooves.
* A typed-array world with stable tile IDs, per-tile orientation, edge weld storage, and allocation-free per-tick movement buffers.
* Deterministic straight-down gravity for stone, metal, magnets, and sand; complete downward body-dependency resolution; parity-selected diagonal gravity for sand; direct-fall priority; equal-priority destination jamming; and reciprocal magnetic constraints that hold bodies when supported while allowing unsupported attracting groups to fall.
* Simulation commits remain discrete and deterministic while stable tile IDs drive smooth eased rendering between the previous and current positions. Manual steps animate for 200 ms; automatic steps animate for up to 250 ms without delaying simulation ticks.
* Deterministic tests for gravity chains, sand overhangs, welded and magnetically constrained bodies, conflicts, directional welding, orientation snapshots, boundaries, stable IDs, and reset behavior.

## Code map

* `index.html` — Application shell, tile and weld palette, canvas, and simulation controls.
* `src/main.ts` — Browser entry point, example world setup, input handling, build tools, and animation loop.
* `src/styles.css` — Responsive application, palette, board, and control styling.
* `src/vite-env.d.ts` — Vite client type declarations.
* `src/render/canvas-renderer.ts` — Responsive Canvas 2D grid, welded-body flood fill, stable-ID movement interpolation, hit testing, placement previews, and hover feedback.
* `src/render/grid-drag.ts` — Board-clipped tile-drag endpoints and continuous weld-edge traversal between pointer events.
* `src/render/tile-renderer.ts` — Body outline tracing and rounded-slab drawing (fill, bevel lighting, decorations) for the board and component palette.
* `src/simulation/tile.ts` — Tile kinds, directions, and immutable tile behavior/render definitions.
* `src/simulation/world.ts` — Typed-array tile, orientation, and weld storage; stable IDs; snapshots; editing; and body movement commits.
* `src/simulation/simulation.ts` — Allocation-free welded and magnetically constrained body collection, gravity intent selection, conflict resolution, and tick advancement.
* `src/util/assert.ts` — `expectDefined` assertion that crashes loudly on violated lookups instead of falling back silently.
* `tests/simulation.test.ts` — Deterministic world, gravity, diagonal movement, conflict, weld, magnet, identity, and reset tests.
* `tests/grid-drag.test.ts` — Continuous tile and weld drag traversal tests, including board-boundary clipping.
* `vite.config.ts` — Vite configuration with Vitest's Node test environment.
* `tsconfig.json` — Strict browser TypeScript and project build configuration.

## Current TODOs

* Bug with rendering connected bodies: Place 8 stone blocks a ring, with 1 empty space in the center. Weld them all together. Unweld one edge A. Then unweld a different edge B on the other side. Unwelding B causes the appearance of edge A to change. The problem is basically that we're drawing one path for the entire connected body's outline, and then adding a seam line for one unwelded edge, but it looks wrong because it's patched on afterwards. Really our outline paths should depend on local weld states / connectivity.
* Rework the overall UI. Currently the grid is a small region of the screen, and there's no way to zoom in or pan; this will be a problem for larger puzzle maps later. Instead, make the grid the background layer. Add the sidebars (palette, run/step/reset/clear, etc.) as panels floating on top of this. Start with the grid centered and zoomed in a way that allows seeing the whole grid with none of it hidden behind panels. Allow zooming the grid with mousewheel, and panning with arrow keys or RMB-drag on an empty region of the screen. Draw space outside the tile grid as black. Allow panning as long as the center of the screen is still over the tile grid (or any similar rule that ensures players don't accidentally get lost when panning and end up unable to find the grid again). Remove unnecessary UI elements like the title at the top; keep only left panel (tools, components, controls) and bottom panel (run, step, simulation speed).
* Rendering optimization: currently outline `Path2D`s are rebuilt every frame. We should instead cache per-body paths keyed on world edits/ticks.

Related to animation system recently implemented:
* Compute the next simulation step async, while the last update is still being animated. Would improve performance if simulation step time grows over frame time.
* Add an option to disable animation and instead step discretely.
* Add a 60 ticks per second option (or "max" option) for simulation speed. Disable animations in this case.

## Development guidelines

Keep the simulation deterministic and independent of rendering. Some information (e.g. list of connected bodies) can be shared.

Handle unexpected undefineds loudly. When a lookup is logically guaranteed to succeed (e.g. checked indexed access under `noUncheckedIndexedAccess`), narrow it with `expectDefined` from `src/util/assert.ts` rather than a silent fallback (`?? default`, guarded `break`/`continue`). We want violated expectations to crash with a descriptive message during development, never to continue silently with wrong state. Reserve explicit fallbacks for cases where absence is genuinely valid.

Prefer a new focused file for a new concern.

Let's target one screen of blocks, maybe 400x300 tiles at most, on low-end hardware, animated at 60 FPS, with maybe 5 sim update steps per second.

No legacy compatibility is required. We are in early development. Make clean cutovers and remove obsolete callsites/aliases.

After completing changes, commit them to `master` or the current worktree. Self-contained commits are preferred.

## Build and verification

* `npm install` installs dependencies.
* `npm run dev` starts the Vite development server.
* `npm run build` type-checks TypeScript and creates the production bundle in `dist/`.
* `npm test` runs the deterministic simulation tests once.
* `npm run test:watch` runs tests in watch mode.