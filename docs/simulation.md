# Simulation reference

For physics, circuit, component, and board-format changes. See [UI/lifecycle](ui-lifecycle.md) for session ownership and [rendering](rendering.md) for visual state. Planned changes belong in [todos.md](todos.md).

## Ownership and tick model

* `src/simulation/world.ts` owns typed-array tile kinds, stable IDs, orientations, charges, furnace state, weld edges, and sparse per-ID component state. Empty cells have ID 0. Geometry and visual revisions are separate.
* `simulation.ts` coordinates observation, intent resolution, and commit. Components observe the start-of-tick state, not another component's newly committed action. Circuit propagation resolves an entire welded network in one phase; gates use previously observed inputs.
* `world-runtime.ts` retains one `WorldRuntime` per board identity, bundling resolvers and scratch buffers. `world-features.ts` centrally maintains feature counts and row-major bitset indices through tile-kind mutations. Passes skip absent features.
* `welded-body-index.ts` retains start-of-tick body membership, bounds, and exact structural matching. `motion-workspace.ts` privately owns ordinary-motion and piston scratch state. Keep hot tick paths allocation-free by reusing typed buffers.
* Equal-priority competing intents jam. Resolve complete dependencies before moving any body; do not let iteration order pick winners. World boundaries are solid.

Each tick collects intents throughout the root/nested-board tree, resolves circuits forest-wide, then commits the remaining phases in each board, children before parents. This lets duplication copy fully advanced inner contents. Preserve the explicit phase order in `simulation.ts`: circuit observations use old welds, whereas motion uses committed weld changes. Furnace/delivery/duplication changes can invalidate later machine claims; resolvers recheck the relevant IDs, kinds, and destinations before committing.

## Motion and machines

| System | Current contract / extension point |
| --- | --- |
| Gravity | Eligible bodies move at most one cell per tick. Straight-down movement outranks parity-selected diagonal sand movement and conveyor motion. Unsupported touching bodies resolve complete downward dependency chains. Platforms are fixed; sand is not weldable. |
| Magnets and conveyors | Magnetic contacts group bodies against gravity, couple conveyor movement along the contact normal, and permit tangential sliding. Belts apply tangential forces to unwelded neighbors and opposite reactions to themselves. Unsupported bodies fall first; belts cannot lift gravity-affected bodies. Supported movement resolves force sums, pushing chains, fixed blockers, and destination jams. |
| Pistons | Positive charge prefers extension and forward pushing, then base recoil/rear pushing if blocked; a boundary can brace recoil. Negative charge retracts and pulls only a head-welded body. Neutral holds. Extended base and arm have separate IDs; head welds follow the arm while other welds/ports remain with the base. |
| Rotators | Rear +1/-1 turns a forward/side grip clockwise/counterclockwise, never toward the rear. A cell-center quarter-circle supercover recursively collects swept bodies and enclosed loose contents. Fixed terrain, boundary crossing, self-capture, or overlapping turns jams the entire proposal. Turns preserve IDs and transform orientations, welds, crossing axes, and oriented state. |
| Welders/splitters | Operate on the two transverse edges of the cell ahead. Shared side -1 disables; isolated rear output pulses on a change. Opposing operations on one edge jam. Changes commit after circuit resolution and before motion. |
| Furnaces | Transform sand to glass in four active ticks or ore to iron in six. Shared side -1 pauses using start-of-tick charge, preserving progress; target-ID changes reset progress. The isolated rear output is +1 on each active baking tick, including completion, and 0 while paused or without a recipe. Welded side ports link adjacent furnaces into one control network. Recipes live in `furnace.ts`. |
| Delivery boxes | Compare complete front/rear bodies under translation only: kinds, directional orientations, and weld topology, not configuration. Atomically consume the front match and pulse sideways. Competing claims jam. |
| Body comparers | Use delivery-box translation-only matching on complete front/rear bodies without consuming either. Drive +1 continuously on the shared side network while matched, otherwise 0. Missing neighbors or bodies welded to the comparer do not match. Observe start-of-tick geometry, including inside rune arrays. |
| Duplicators | Prior positive shared-side charge mirrors the rear body onto the pointed side. All destinations must be empty/in bounds; overlapping output intents jam. Copies get fresh IDs, mirrored orientations/welds, copied runtime configuration, and remapped internal furnace target IDs. |
| Assemblers | Match the complete front body against precomputed recipe rotations, ignoring internal configuration. Consume atomically, queue rotated outputs, then emit one unwelded fresh-ID tile per tick behind while space is empty. Pending queues block new consumption. Body/output claims jam; earlier delivery, baking, or duplication can invalidate a commit. Recipes and variants live in `assembler.ts`; queues follow transforms and persistence. |

Dedicated `*-resolver.ts` files own machine intent collection and commits. General-purpose non-conveyor pushing remains future work; reuse existing dependency/conflict machinery rather than introducing order-dependent movement.

Raw materials include dirt, gold, silver, ruby, sapphire, emerald, diamond, amethyst, mithril, copper ore, copper, and wood. These use ordinary weldable, gravity-affected solid-block physics without magnetic or circuit behavior. Copper ore has no furnace recipe yet; the existing sand/glass and iron recipes are unchanged.

## Circuits and configurable state

`circuit-resolver.ts` resolves signed-ternary (-1, 0, +1) driver sums by sign. Cached welded-network union topology spans all nested boards and invalidates when geometry or the tree changes. Compact nodes cover circuit cells, with a lazy cell-to-node lookup.

* Conduits share one network; crossings isolate horizontal/vertical axes. Mechanical weld eligibility and circuit connectivity are distinct.
* Fixed charge drives +1 every tick; spark only on the first tick. Occupancy sensors inspect exactly one forward cell and ignore kinds marked `invisibleToSensor` (glass), without seeing through them. Charge sensors read the front neighbor's old charge, permit front mechanical welds but no front circuit link, and drive their other three isolated outputs.
* Directional gates isolate inputs from outputs. Inverter, combiner, rectifier, subtractor, selector, multiplier, equality, minimum, and maximum use metadata-defined ports. Multiplier/equality/minimum/maximum ignore disconnected inputs; empty-input identities are +1/+1/+1/-1. Connected neutral input is not disconnection.
* Delays advance a configurable ternary ring buffer. Counters accumulate signed input modulo a threshold, pulsing in the wrap direction. ROM left/rear inputs move a wrapping 2D cursor; crossing an edge carries into the other dimension. Front/right outputs drive the selected value.
* Sequence checkers ignore rear input until its first nonzero value, then compare one row-major expected value per tick. Optional `ignoreZeros` mode waits through every neutral input and checks only the order of +1/-1 values; its expected grid must contain no zeros. They latch failure at the mismatched cursor or success past the final value. Changing either the grid or mode rewinds cursor/verdict. The mode follows cloning/transforms and scene persistence; an omitted JSON flag means false.
* Victory inputs latch root win/loss from positive/negative charges; opposing same-tick intents jam. Monitors merely join circuits; history and checker start ticks are display state, not serialized simulation state.

`configurable-components.ts` owns configuration definitions, validation, defaults, snapshots, cloning, and rotation/flip transforms. Sparse runtime state is broader than player-editable configuration (e.g. assembler queues, rotator grips).

## Nested rune arrays

`rune-array.ts` defines odd inner dimensions from 1x1 to 15x15 (default 5x5), centered resizing, ports, and nesting rules. Each array owns a full inner `World`; arrays nest recursively, with every ordinary phase active inside.

The four inner edge-center cells connect as if a conduit sat just beyond each edge. Four independent outer side networks join the forest-wide circuit solve without extra delay. Inner victory latches the root result; nested boards have no separate result.

Charge sensors facing outward at an inner edge-center port read the actual outside neighbor's start-of-tick facing-port charge without requiring an external weld. Sensing traverses enclosing arrays when their cells also lie at matching edge-center ports; other wall cells and the root boundary read neutral. This does not electrically join the sensor's front to the array port or change ordinary gates' virtual-port inputs.

Rotation/reflection transforms the inner board physically, keeping its gravity downward. Copies/resets reuse an existing inner world with matching tile ID and dimensions, preserving mounted views and resolver caches. In puzzles inner components cost their full catalog prices; the containing array occupies one footprint cell.

## Adding or changing components

Start with `tile.ts`: the registry supplies behavior, board codes, directionality, palette grouping, descriptions, and suggested prices. Then inspect the relevant resolver and its tests. Stateful additions also need configuration/snapshot/transform handling, feature indexing, and board serialization; visual and editable additions need the shared renderer and configuration workflow, respectively. Do not invent a parallel metadata registry.

Check movement, cloning/reset, rotations/reflections, duplication, and nested boards for new state. Preserve stable IDs during movement and allocate fresh IDs only for genuinely new tiles. Feature indices and revisions must remain correct through every mutation path.

## Serialization and verification

`board-export.ts` owns deterministic versioned scene JSON: explicit bounded dimensions (1x1 through 400x300), compact ASCII kind/weld grids, sparse orientation/charge/runtime state, and recursive array contents. Weld codes are `.`, `-`, `|`, `+`. Optional empty sparse fields are omitted and import as empty. Runtime IDs are deliberately excluded and reconstructed on import.

Validate the complete board and sparse state before replacing a live world. Nested contents use the same board fields without top-level format/version/tick/result; nesting is bounded to eight levels. Puzzle wrappers/catalogs/case overrides are covered in [UI/lifecycle](ui-lifecycle.md).

Focused regressions live in `tests/` by subsystem: `simulation`, `circuit`, `conveyor`, `piston`, `rotator`, `weld-operation`, `furnace`, `delivery`, `duplicator`, `assembler`, `checker`, `rune-array`, `world-features`, and `board-export`. Exercise observable behavior, conflict/boundary cases, and state preservation rather than duplicating the implementation. `tools/ternary_logic_search.py` explores minimum-size combinational ternary circuits independently of physical layout.
