Tasks that are not actionable yet due to prerequisites, or are lower priority, are marked as DEFER.
Tasks that are likely to be easy to implement marked as EASY.
Tasks that are key blockers to shipping the first version are marked as PRIORITY - once these are resolved, we'll upload our first version to Itch.io.

# Game flow

## Sim test/play flow

* Add tick speeds above 60 ticks per second; for those, step the simulation multiple times between renders. This is useful for testing solutions fast while still showing what's going on.
* Modify our "fast" test option to still render sometimes, say every n ticks or at 60 FPS. Currently it runs the sim only, skipping rendering entirely, which may be undesirable since e.g. it makes infinite loops not visible.
* Modify UI: instead of only showing "fast" button after "test" has already been pressed, rather always show it, and allow pressing it to test fully in the fast mode. Some players would want to test mostly in fast mode.
* DEFER Add a step-back button to the control panel at the bottom, maybe? Requires keeping previous state in memory, or several so we can step back multiple ticks.
* DEFER If we do the "asleep vs active regions" change below, or if we store previous state for step-back, then as a follow-up: when testing a solution, check for loops (no active regions, or previous state equals current state) and end the test early.

## New puzzle types

* DEFER Add support for a new puzzle type, where the player starts with a machine that doesn't work. They have to modify as few tiles as possible to make it work. Same scoring rules but we only count modified tiles. Add some way to view what tiles have been modified - maybe color grid lines yellow if their contained cell is modified. Could auto-generate some of these puzzles from reference solutions.
* DEFER After the last set of puzzles is unlocked, also unlock a "full toolbelt" equivalent of every puzzle - a variant where all components are available, with the same list of prices for each. This adds some content, lets players compete on more histograms.

# Storage format, import/export

* DEFER Further compact orientations and charges in the scene and tutorial export/import formats, possibly storing charges per network instead of per tile. More complex per-tile state (e.g. furnace stored ticks or target/delivery-block configuration) can remain verbose. Only include full ASCII grids for fields that aren't empty / default value everywhere.
* DEFER Allow importing scenes in puzzles, not only in the sandbox. But only allow them to modify the player-modifiable regions, including welds on the perimeter. This could be useful for sharing solutions. Or, if we don't allow importing scenes except in the sandbox, then remove the import button on puzzle screens - currently it's disabled but still taking up screen space.
* DEFER Minor bug in exported puzzles with additional test cases: we're exporting the extra test case as a full puzzle description, it seems, without checking which fields actually changed vs the main/standard test case of the puzzle. The test case only needs to define fields that actually changed, others are assumed equal to the standard case so can be omitted to make the format more compact.

# Authoring tools, player-created puzzles, histograms

* PRIORITY Add back-end server and database. Probably Cloudflare Workers + D1 + R2. Then make the game request histogram data and (later) shared puzzles, and allow submitting scores and shared puzzles. Use `crypto.randomUUID()` to assign each install an ID.
* DEFER Allow voting community-created puzzles up and down. We can assume users aren't malicious, this is a zero-stakes indie game; expect under 10 players per day. We want to avoid setting up a whole auth system or requiring email addresses, etc. Using a simple unique ID allows exploits (e.g. clear browser data and double-vote) but we'll assume nobody does that. Version the database and roll back manually if needed. If the game becomes popular enough to need more than that, upgrade to a more robust system.
	* Also, when using the "clear all player data" button, do not erase the UUID. Unclear what we should do when importing/exporting - maybe transfer the UUID.
* DEFER For community puzzles, organize them automatically by their set of allowed components. Unlock each after the earliest built-in progression point where all of those components have appeared in that group or an earlier group.
* PRIORITY Add histograms on the puzzle solution result modal. Rate solutions by percentile as coal, iron, gold, mithril. On the puzzle briefing screen, show the player's best score and percentile-mineral rank on each of the 4 metrics - for each metric, take the min/best over all their solutions. Also, if they have 2 or more solutions, the result modal should show their best score and the current solution's score for each metric, on each histogram. The histograms for each metric should use data from each player's best solution on each metric to that puzzle - so we'll need to remove the old value and add the new value.

# Hardening

* For built-in puzzles, store a canonical solution in a separate file, produced by scene export from the browser. Add tests that run each of these solutions and check that they actually succeed. Helps avoid regressions that make puzzles unsolvable.
* DEFER Try to do some fuzzing to find crashes or undesirable behaviors. There may be edge cases involving things like pistons welded to other pistons and magnets, etc. Could also check for cases of machines that can fly/levitate, or produce blocks endlessly, though those should not be "fixed" until we've looked at them manually to decide whether they should be considered bugs or features.

# New non-circuit components

* Assembler follow-ups: the recipe table is a placeholder (sensor pair, piston, lodestone, conduits) and needs real game recipes once copper and other materials exist. Consider mirrored inputs (maybe just adding a mirrored recipe), a side circuit pulse on consumption or emission like the delivery box, a side disable input, and per-recipe output welds.
* Flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide/overlap other blocks. Similar to Kaizen game's rotation.
* Laser splitter: splits everything in a single line, e.g. the left side of every block in its forward direction.
* Add a press/stamper/crusher. Behaves similarly to the piston, but (1) if piston extension is blocked by another tile, and that tile can't be moved, it instead unwelds and destroys that tile; and (2) we have a list of recipes for transforming the tile that the extended arm touches, on extension.
* Grinder blocks that process a block in front into a product block - exactly like the furnace, but with a distinct table of recipes and different appearance (and later animation and sound).
* A drill/destroyer block that destroys the block in front of it.
* Replace the current magnet with an electromagnet. Positive and negative charges make it switch polarity; opposite sides have opposite polarity. Both nonzero polarities stick to iron. Like magnet sides repel, opposite magnet sides attract.
* Maybe add static non-controllable magnets, which are also non-directional.
* Component that makes its welded body immune to gravity, but can still be pushed down by an independent body on top that falls under gravity. (Platform block already does the first part, but cannot be pushed, and can't be moved by pistons.)
* Animate committed rotator quarter-turns around their pivot. The simulation already commits them atomically; rendering needs to retain each accepted pivot, direction, and moved stable-ID set so every carried body follows the same circular interpolation without feeding continuous geometry back into collision resolution.
* Add blocks that play a chime or other sound when charged.
* Add a component that has no gravity, and moves forward one tile every time step; when blocked, attempt to push the tile in front. Could be useful as a model for many later components: arrows fired by elves, thrusters, etc.
* Add a "box" component that has an internal grid of miniature components. Similar to the implemented rune array (reuse its nested `World` state, `WorldRuntime` tree, entering/leaving view, and nested board format), but instead of circuit signal ports, add holes where blocks can fall in/out or be pushed in/out. A miniature block that falls out through a hole becomes a full block on that side of the box; a full block that falls in becomes a miniature block. Similar to Factorio's warehouse mods, or Patrick's Parabox.
* Add a slider component that cannot be moved in one axis, only the other axis. Allow rotation, which changes which axis is fixed. A welded body with sliders has all of their constraints - so with both horizontal and vertical sliders, it can't move at all.
* Add a fastener block. It makes its welded body immune to gravity, but as soon as the body is pushed by any force besides gravity (currently pistons, conveyor belts), the fastener block is destroyed. If another block falls onto the fastened body, that doesn't break the fastener (because otherwise there'd be weird behaviors where unwelding one block in the fastened body makes the fastener break).

# New component behaviors

* Figure out how we need to modify ROM blocks to make them behave reasonably when rotated or flipped. Probably we should rotate the internal stored memory, and swap the grid width/height. Also need to make them symmetric so that 180 degree rotation equals flip - probably need to replace one of the output ports with another input port.
* Add a fragility flag to tile kinds, and set it to true for glass blocks. A fragile block with no welds that drops and then stops falling should be deleted (later animated with a shatter effect), unless it fell only one tile before stopping; would require storing additional data per fragile block. Most blocks won't be fragile so this is fine. Could create interesting puzzles like lowering blocks one tile at a time with pistons, or welding before dropping and then unwelding.
* Add a flag in the tile definition for glass blocks, to make the sensor rune not detect them.
* Add an indestructible flag. Blocks like crushers and drills should not be able to destroy these. Needed to prevent some exploits when solving puzzles, e.g. by drilling into the ground and activating the victory block.
* Furnaces could have special behavior if said neighbor is surrounded by certain other neighbors. Add this to furnace recipes.
* Furnaces could trigger a block to weld to neighbors after cooking it. Add to furnace recipes.
* Furnaces could have stages, e.g. cookie dough -> cookie -> burnt cookie, creating timing challenges.
* Modify the assembler to add reaction force: When it has a pending output, but no space to output, shift the assembler in its forwards direction, emitting the product out the back (at assembler's pre-movement position). Allow this motion to push other blocks that are in front of the assembler.
* Modify the duplicator in the same way as assembler above - make it also attempt to push itself away from the output side, if it's trying to duplicate a single-tile body but there's something blocking the output. When duplicating multi-tile bodies, don't do this - require already empty space for the whole body.

# Performance

* Optimizations noted in `docs/performance-todos.md` - some have been completed and greatly improved performance.
* Profile again after doing those already-noted performance tasks, and determine if there's any need to optimize further, and if so, what to optimize.
* Check if we're caching connected/welded bodies, or flood-filling every frame. Could cache it and update only on the infrequent weld/unweld operations. Also check if the simulation and rendering are tracking connected bodies separately - if so, consider adding a getter on simulation system to read information on multi-tile bodies, and call that from the renderer.
* Mark some tiles or regions as asleep, if they have no updates. Wake up only regions where things are happening. E.g. a static structure made of only solid no-action blocks doesn't need to be processed every frame, doesn't need to re-check gravity every frame, etc.
* Cache circuit networks instead of rebuilding every tick.
* Maybe: Compute the next simulation step async, while the last update is still being animated.
* Potential issue later: we may have very large connected bodies. For example a puzzle in a 400x300 map almost entirely filled with welded stone blocks, where the player needs to build a mining machine. Every time they mine one block, that entire welded body changes and may trigger work to update its entire border. We might need to split the body into chunks and make separate paths for their borders, meeting at the chunk boundary, or something like that.

# Circuit network

## New circuit components

* A sensor that detects when the sensor's own tile moves, and outputs +1 on that side, -1 on the other side.
* PRIORITY (for some key puzzles): Add comparer component that compares front neighbor to back neighbor, outputs +1 on sides if they're equal, else output 0. Make it compare entire bodies, exactly like the delivery box but without consuming.
* Add a ternary LUT component. Two input lines, two identical outputs, similar to the ROM. Make it configurable (via E-key config modal) using a 3x3 grid, similar to the grids we have for ROMs but with fixed size. Each tick, it should read its two inputs and map them to a unique configured cell in the 3x3 grid, then output the value stored there. We probably won't allow this for most puzzles, or make it expensive, since it subsumes various other components (rectifier, combiner, inverter), but it could still be useful. This is overall similar to the ROM, except that (1) it doesn't have a cursor moved in (0, 1) or (1, 0) increments but instead uses direct addresses given by the two inputs; and (2) it has a fixed 3x3 grid size for the possible 2-trit input combinations. We also don't need to support the ROM grapher component for this LUT.
* Add a "rune engine" component that's like a programmable logic array / gate array, but more native to signed ternary than binary. Details: probably take 2 inputs and produce 2 outputs. The rune engine has a grid of ternary bits which determine the I/O relation. Details to be determined. Could include an internal latch for feedback, like the PGA in Shenzhen IO.
* Add a stack block with push/pop to store arbitrary amounts of data. Maybe front inputs of +1 and -1 are placed on the stack, while front input 0 is ignored. Side input of +1 pops one value, writing it to the back for one tick.
* Add a RAM block similar to the ROM block, but with additional inputs to allow writing to current cursor position? Details would need to be determined - we only have 4 sides, so maybe change to only having one cursor movement input instead of two. Maybe rather don't add this RAM block, and rely on using stack blocks instead (transferring from A to B to read, then transferring back to A to unflip the order).
* Add a delay block, but instead of advancing 1 space per tick, it advances when an additional input is +1. Maybe also allow -1 to scroll back. Uncertain, this seems similar to the RAM block.
* Add a delay block variant that only steps forward if the input is +1 or -1, ignoring zeros. Like the current delay block, on every tick, it outputs the queued value; but we only shift the ring buffer forward and write a value when the back value is +1.
* Add a variant of the sequence checker block (or configuration option on the existing one) to make it ignore 0 values, and only check order of +1 and -1 signals. Potentially useful for puzzles like "given a sequence of gemstones as input, deliver the gemstones in reverse order".

## Circuit component modifications

* Show signal monitors placed inside rune arrays on the signal panel. `SignalTraceRecorder` and the panel only walk the root board today; nested monitors would need composite keys (array ID path plus inner tile ID) and a label showing which array they sit in.
* For signal traces drawn in the signals panel, allow click and drag to reorder them. Probably store ordering on the signal monitor and ROM-grapher components, but hide that number - don't add a box to edit the number directly in the config modal. Only allow reordering inside each category, once categories are added.
* For the signal monitor and ROM grapher: in their configuration modals, add a text input for "category", defaulting to blank. Then on the signal panel, group each category together, instead of board row-major order. Show category names above the traces. Useful for grouping inputs vs outputs.
* Sequence checker follow-ups: the expected sequence must begin with a nonzero value because the checker starts on the player's first nonzero output, so the "bursts" rectifier-puzzle case cannot verify silence during its leading negative burst. Consider an optional arm/start input port, or an explicit "expect silence for N ticks before the first value" configuration, if a puzzle needs it. Also consider a configurable maximum latency that fails a solution outright instead of relying on the cycle limit. DEFER until a puzzle actually needs this.
* Minor: allow charge sensor runes inside rune arrays, pointing at the wall of the array, to read values from outside the rune array.

## Circuit components to not add because they're already buildable

* AND/OR gates - they're binary gates not ternary, and we'll add min/max which are n-ary generalizations of them.
* Edge detectors: can be done by using an inverter to get `-x[t-1]` and using a combiner to add `x[t] - x[t-1]`.
* Latches: can be done by connecting a combiner's output to its input.
* Block that writes alternating red/blue charges every tick. Because we can create this with a spark plus inverter feeding itself.
* Absolute-value, i.e. mapping +1 to +1, 0 to 0, and -1 to +1. Because a multiplier `X * X` does this.
* Don't extend the set of charges (0, +1, -1) to add orthogonal +i and -i charges, or add a 2-wire tile with components for reading the different wires. We'll rather keep the current ternary system since it creates interesting challenges for signal routing.
* Mapping (+1, 0, -1) to (+1, -1, anything) - can be done with `Combine(x, x, -1)`, or if -1 isn't available then `Combine(x, x, Invert(Combine(x, 1)))`.
* Don't add a block that's programmable in assembly or some other text language. The implemented "rune array" covers that role and fits better with our theme and the rest of the game.

# Game feel

* Try out alternate easing for movements. Maybe define per-block easing.
* Add sounds. On block placement/removal, welding/unwelding. On victory block triggering.
* Add various animations for clicking buttons, placing blocks, starting a puzzle, etc.

# UI

* For each tile, in addition to the description, add an extended, potentially multi-paragraph description. Include things like details of how ROM rune's cursor movement works, and a color-coded truth table for the combiner rune, etc. Display these in the inspector, when the mouse is over the palette. When the mouse is over the tile grid, instead only show the short description.
* When saving an image using the image button, crop out parts of the screen that are over the background, outside the grid, if this can be implemented easily.
* Implement undo and redo when editing.
* Show brief text like "+2⚙" above the current puzzle price as components are placed; make it fade to transparent after a brief delay. Animate negative numbers when removing blocks. Color them blue for positive, red for negative, same as circuit charges. When many components are added/removed in rapid succession, grow the current number instead of making many separate text boxes.
* Add support for mobile and touch screens. Check if it's playable.
* Modify sizing to make things more visible on 4k monitors. For example the prices of components are currently displayed very small in the inspector. Might also be an issue on 1080p though, so this may be a general sizing issue rather than UI scaling.
* EASY In the sandbox, instead of showing `0 (gear symbol)` next to components, show nothing, because prices don't make sense for the sandbox.
* PRIORITY EASY? On the puzzle results screen, add a button to go directly to the next puzzle's briefing screen - if the solution succeeded, and there's a defined next puzzle, and it's unlocked. Display the next puzzle's name. This is meant to help reduce menu navigation needed when we have several easy tutorial puzzles in rapid succession.
* Allow mirroring components with some hotkey. Because we allow mirroring selections, and we'll add components like flippers. But this probably currently breaks things like ROMs which do not have mirror symmetry. Also check all components for any that have rotational asymmetry that may cause a rotated machine to behave differently, e.g. ROM cursor's wrapping behavior may break rotational symmetry.
* Modify the tick speed menu to use our own drop-up widget (like the export button).
* Add an option to the export menu, in puzzles, to open the current puzzle in the sandbox.
* DEFER Maybe support selections that are a union of rectangles, created by shift-LMB-drag.
* EASY? When a region is selected using the selection tool, in the sandbox, add a new tool that will crop the board to that selection. (Currently it requires using the puzzle properties modal to set the grid size to specific numbers; this selection path would be easier and more intuitive.)

## Puzzle briefing screen

* DEFER Later instead of a gold highlight, choose color according to a grade decided by percentile on the histogram - iron, gold, diamond, mithril. Also, on the main menu, color completed puzzles' buttons by the grade of the player's best solution.
* DEFER Also style the 4 scores of each solution according to their grade in the histogram for that specific metric.

## Settings menu

* Add color-blindness options for people who can't distinguish red and blue circuit wires. Maybe just let them specify colors (from a short menu) for charges +1 and -1. Also apply these to the cost change popups.

## Workshop (puzzle/sandbox) screen

* Show a small icon to the right of the cursor, for the currently-selected tile or tool - the weld icon, the "place player-modifiable regions" tool icon, and the icon for a tile. When ctrl is held down (to weld), it should switch to the weld icon.
* Make the palette panel resizable. Modify the icon sizes, shrinking them as the palette becomes narrower.
* PRIORITY Modify the overall layout when solving a puzzle, and in the sandbox. Add a section at the top of the palette panel, always visible even when the palette is scrolled. Move the "back" button (back to puzzle or main menu), the puzzle title, and the info button to that top-left region - currently they're all in the bottom-left `workshop-identity` region. Keep the total price and the footprint readout in that workshop-identity region. Increase display size of the puzzle title (unless the name is long), and increase display size of the live puzzle metrics (cost and footprint readouts). Add the decorated border (`src/styles.css:178`) to the top-left region.
* If the player tries to place a block, or weld, and we don't allow it, indicate the reason. (1) If it's because they're testing a puzzle, flash the reset button. (2) If it's a weld or tile edit outside the allowed region, flash the region border red. (3) If they're trying to weld an edge that can't be welded because one of the neighboring blocks can't be welded on that side, e.g. sand blocks or empty blocks or the front/back of a duplicator , draw a brief low-opacity red square overlay on those tiles.
* PRIORITY Modify block placement: when using LMB-drag to place multiple blocks, automatically weld them together (if allowed) along the edge that was dragged. So e.g. dragging a boustrophedon pattern will weld in the same snake pattern. This is different from shift+LMB which welds along all edges.
* When we show the success screen / puzzle solution results screen, show the delta vs the player's previous best solution in each metric, if they have any previous solutions. So they can see easily whether their new solution improved on the previous one in each metric.
* Add some way to copy-paste per-component configuration between configurable components. Maybe when the selection tool is used to select some components, add a "copy config from..." button which allows clicking on one component and then copies its config to all selected components of the same type.
* EASY? On mouseover on a trace line (in the signal panel), highlight the relevant component in the grid - the signal monitor or ROM grapher that produced that graph.

## Shortcuts

* EASY? Add shift + mousewheel to scroll through palette entries, when mouse is not over a number configurable component (because in that case shift+mousewheel configures the number).
* EASY Add hotkeys for game controls: step, reset, and test-fast. We'll modify the "fast" button to be visible even before "test" is clicked - separate item in this doc. (Don't add shortcuts for for "clear", test cases, export, or speed control.)
* EASY Add a shortcut for the selection tool. Maybe alt key, similar to how we have ctrl for the weld tool.
* When the player has entered a rune array, allow middle-click to pick the virtual conduit blocks at the edge midpoints.

# Visuals

* Bug: When using the selection tool, ROMs in the selected region don't show their configured values - they show black for all cells. Seems to be a general issue with not tracking or rendering the configuration details - delay runes also don't show values.
* Add backgrounds for puzzles, maybe with parallax as the player pans.
* EASY Rename runes; prefer metaphorical, arcane, or Anglish-style names. ROM rune -> rune of wisdom, sensor rune -> watchful rune, inverter -> gainsayer rune, delay rune -> recall rune, rectifier -> rightener, etc. Maybe rename +1, -1, and 0 to right, left, and center, or some other natural ternary system, if we can find a way to explain sum, multiply, and subtraction concisely in that system. Also rename the assembler - anvil or forge or something else?
* EASY Swap the symbols used for the selection tool and the player-modifiable region tool, but keep them with the same colors. (Selection should be dotted line, cyan, while modifiable-region tool should be two 90-degree lines, yellow.)
* Make the rune array modal show a read-only thumbnail of the inner board next to the dimension inputs, so players can judge what a shrink will crop before saving.

## Specific block appearance changes

* Make the glass block look more like transparent glass. (By adding a specular-like white highlight, and making it darker in the middle and brighter on the rim to simulate Fresnel, I think. We don't need actual rendered transparency.)
* Replace the current rune icon set with more intuitive or pretty symbols, matching the rune theme. Make stone/glass/platform have two parallel lines instead of the Z-lightning-bolt. Block sensor should have angular rune-like eye symbol (hollow diamond with center diamond for the pupil); charge sensor should be the same eye with lighting bolt replacing pupil. Fixed charge should have 3 lighting bolts, not plus symbol and circle. Inverter should be "hagalaz" N/H symbol. Subtractor should mark back with a small plus. Rectifier should be "thurisaz" `|>` instead of current `>|` diode symbol. Victory block should have "jera" rune symbol. Magnet should be reworked, but defer until we change its mechanics. Also give them sensible background colors, e.g. shades of purple for all sensors, teal/blue for all 3-input mathematical transforms.
* When placing welders/splitters, show additional bars for where the welds/splits will happen.
* EASY Standardize side output and input arrows on our components. The "ROM grapher" component's side arrow looks good. Change arrows on delay rune, charge counter, and ROM rune to match that (except flip direction for inputs). Also similarly change arrows on combiner, multiplier, and subtractor, to match these, though note their arrows light up with a color. Also we don't need to add new arrows to any of these - some of them like the combiner have 3 inputs and 1 output, but we don't need to mark the inputs since it's already clear visually.
* Make circuit components (logic gates, sensors) look more like shiny gemstones instead of smooth pebbles. Maybe they just need specular highlights.
* Modify colors for all runes. In general they're too pastel and muted. The teal of the platform block looks especially bad; it's also used by combiner and ROM.
* For the rotator component, we should modify rendering to make behavior more obvious. Maybe draw as a welded block with only around a third of the width, on welded side, and then draw the rotator arm separately. Also mark red/blue on the sides of the base to show which charge rotates in which direction. Also animate the rotator arm itself turning (different from animating the bodies it rotated).

## Styling

* Refine the dwarven UI theme: the palette now lives in CSS custom properties on `:root` in `src/styles.css` (stone browns, bronze, gold, ember, gem accents) with gilded corner ornaments on major panels; consider richer Art Deco corner motifs (diagonals, doubled lines) and reviewing tile fill/decoration colors in `src/simulation/tile.ts` for warmth.
* EASY? Add a dark/light mode toggle. Set to dark by default, or browser default. The `:root` custom-property palette is the switching point: add a `[data-theme="light"]` override block and a persisted toggle.
* Add some more gradients. The current gradients on e.g. the "Sandbox" button and solution list look really good. Use them for more buttons, and for the editor panels (palette panel, bottom bar, inspector).
* EASY Convert more text regions to a serif font, instead of small-caps or sans-serif.
* EASY Change color of the game-canvas region outside the game board - currently it's black, change it to a very dark brown (darker than game board and panels).
* EASY? Check remaining button styles for system/browser defaults. The component-configuration and text-box modal actions now use themed bronze buttons and gold Save buttons; audit other surfaces for similar contrast issues.

## Animations

* Animate when joints are welded or split, including by the welder/splitter components and by the player.
* Improve piston extension/retraction animation.
* Add animation for the delivery box - animate tiles moving into it, and shrinking, as they're absorbed.
* Animate fragile blocks shattering - maybe split them in half across say a line at 30 degrees from vertical, then animate the halves moving apart and fading out from one tick to the next. Also use the same shatter animation for blocks broken by mining devices, fasteners that break, etc.
* Interpolate movement inside a rune array while its contents are displayed and the array itself moved in the same tick: the nested previous world is matched by ID path, which works, but a resized array yields no interpolation source for that tick.

# Larger projects, DEFER to later or never, and break up into tasks:

* DEFER Add a hexagonal variant. All tiles become hexagons. Most of our code probably still works, though using 6 neighbors instead of 4.
* DEFER Add a system of mechanical devices, a bit like our current ternary circuit system (conduits, inverter, etc.) but with different visuals and different mechanics. Since the game is 2D, we're restricted to motion that's legible in 2D - so use chain drives rather than driveshafts. Add chain drives that can rotate clockwise (+1), counterclockwise (-1), or stay still. Add gears (closer to one edge of the cell) that rotate in the inverse direction from that cell. Tint rotating components blue/red to make charges more visually distinct. Add equivalents for our runes: sensor rune becomes pressure plate, inverter is just a gear, wire-crossing is crossed chains. Others I'm not sure about: combiner, rectifier, multiplier, subtractor, sensor, selector. Also motors and generators to convert between runes/conduits and these clockwork components; maybe unify with the rotator block. We may add this as a later alternative to runes and conduits, for additional challenge.
* DEFER Add recursive puzzles in the style of Patrick's Parabox - the entire puzzle is a block which contains itself. Use the miniature-block box component mentioned in another item - the entire level is a box that contains itself as one internal tile.
* DEFER Blocks that set specific rules, e.g. what can be smelted to what. Allows puzzles in the vein of Baba Is You, or just more freedom in puzzle design. Advanced puzzles could involve changing the rules physically on the game board. Maybe have a "rule" block that looks like an arrow. Can be configured to set furnace recipes, grinder recipes, assembler recipes.
* DEFER Look at other puzzle games (The Witness, various Zachtronics games, Roody:2d) for inspiration, though not lazy copying of puzzles. Add any components necessary to allow implementing similar puzzles in our game. For example, we could make Witness-style mazes by letting the player place only conduits, and they have to link a fixed charge to the victory block; but how could we implement other constraints from Witness's puzzles?
* DEFER Add elf archers with some simple behavior. Add arrows that they can shoot, which arc up for 2 tiles diagonally, then travel to the side and destroy the first block they hit.

# Puzzle ideas

* Count up to N pulses from two separate sources and decide which source gave more pulses in total. One solution idea: use a counter block, with an inverter on one of the two inputs, and then check whether final value is positive or negative? But wrap-arounds are possible, so maybe use spark blocks to initialize it to N. Also we can't read the value of the counter block directly, would need to decrement it until it reaches zero and compare number of decrements to initial value; but that seems like almost the same problem we started with?
* A suite of basic circuit problems, where you only have: conduit, combiner, inverter, and fixed source. Add puzzles to build most of the more advanced circuit components out of these. The combiner is effectively a sum or vote/majority rune. Combiner also gives a 1-tick delay, so you can chain them to make a machine that acts like a delay rune with arbitrary memory size. Combiner with duplicate inputs, one delayed and inverted, gives edge detection. Spark is fixed value plus edge detection. For the rectifier/diode, we have a puzzle and reference solution, which needs two combiners and a multiplier. Rectifier could also be built using two combiners, fixed source, and inverter: use fixed source and inverter to get -1, then compute `Combiner(x, x, -1)` which takes (-1, 0, 1) to (-1, -1, 1), and then combine that with +1.
* Physically reverse a list: The player's machine receives ruby blocks and sapphire blocks in some order; they must be output in reverse order. Requires building a physical contraption that behaves like a push/pop stack, or maybe putting them in a box and physically rotating it. The player presses a button to drop the next block, and we drop a stone block to signal the end of the sequence. (How do we build the infra to test? Maybe a delivery box, swapping which block is below it. Or maybe use block-comparer to produce +1 and -1 charge for each one received, and then compare sequences omitting zeros. Or maybe put the entire sequence we expect on a conveyor belt below the delivery box.)
* Physical subtraction: Receive some number of stone blocks and some number of iron blocks; output a number of blocks equal to the absolute value of the difference, then press a button to validate answer.
* Puzzle: Given a supply of sand blocks, and a conduit that pulses N times, move N sand blocks to the output, and the rest to a different output.
* PRIORITY Create a few puzzles that are actually difficult - maybe some of those above.
* PRIORITY Create a few better tutorial puzzles. Use the text box component we've added.
