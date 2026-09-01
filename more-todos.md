Tasks that are NOT actionable yet due to prereqs, or are lower priority, are marked as DEFER below.

Game flow:
* Implement a text-box tool that places and edits text boxes on the game screen. Useful for tutorial puzzles, and also for players that want to label/annotate their designs. Model them separate from the component grid - they're not grid-aligned, don't occupy tiles, and have no prices. Include them the puzzle JSON format and scene JSON format.
* Remove the "import" button on puzzles; it should only be displayed in the sandbox. It's already disabled in puzzles, but still visible.
* Add tick speeds above 60 ticks per second; for those, step the simulation multiple times between renders. This is useful for testing solutions fast while still showing what's going on.
* Add collapsible sections (default collapsed) on the main menu: a credits section, and a technical info section to explain the video game architecture and link to GitHub repo.
* DEFER After the last set of puzzles is unlocked, also unlock a "full toolbelt" equivalent of every puzzle - a variant where all components are available, with the same list of prices for each. This adds some content, lets players compete on more histograms.
* Add a mechanism to detect if previous state is exactly equal to current state. Can have false negatives. The goal is to detect loops, and interrupt execution when testing puzzle solutions. (For example: the puzzle is to drop one stone block on a delivery block. The player drops it in some other location, where it sits indefinitely. We don't want to make them sit through N ticks or have to press fast-forward button.) We could combine this with the "active/asleep regions" optimization pointed out elsewhere in this file.
* DEFER Add support for a new puzzle type, where the player starts with a machine that doesn't work. They have to modify as few tiles as possible to make it work. Same scoring rules but we only count modified tiles. Add some way to view what tiles have been modified - maybe color grid cells yellow if their contained cell is modified. Could auto-generate some of these puzzles from reference solutions.
* Modify the delivery box: it should consume an entire welded body in front of it, if it matches the entire welded body behind it. When consuming, delete the entire body at once. (Later, overlay an animation of it shrinking and moving into the block.) This allows more complex puzzles where the output is a group welded in a specific way.

Storage format, import/export:
* Allow importing puzzle files in the sandbox. Should be almost the same as importing a scene, but also create the player modifiable regions, and later (once sandbox has tools for setting name/descripton and test cases) import those from the test file as well.
* Edit format for scenes and puzzles: make the fields `orientations`, `charges`, `crossingCharges`, `furnaces`, `components` all optional, with default value of `[]`. When exporting, don't specify those fields if they're the empty list, which is often the case. This will reduce incompatibility when we add new block types and de-bloats the format.
* Similarly, remove the "standard" test case with no overrides, from the stored format - treat that as a given and only list additional test cases in the file.
* Further compact orientations and charges in the export/import format, possibly storing charges per network instead of per tile. More complex per-tile state (e.g. furnace stored ticks or target/delivery-block configuration) can remain verbose. Only include full ASCII grids for fields that aren't the default value.

Player-created puzzles, histograms, and authoring tools:
* Make puzzle share/save options open a modal to enter the name, description, and goal. We'll use this both for authoring puzzles easily, and for later allowing users to share puzzles to a public list of community puzzles.
* Add a properties button, visible only in the sandbox. Allow setting the grid size, a list of tiles with checkboxes for whether to enable player placement of them in this puzzle, and a number input for price. Later other things like the background image, gravity, etc.
* DEFER Add back-end server and database. Probably Cloudflare Workers + D1 + R2. Then make the game request histogram data and shared puzzles, and allow submitting scores and shared puzzles.
* DEFER Use `crypto.randomUUID()` to assign each install an ID. Allow voting community-created puzzles up and down. We can assume users aren't malicious, this is a zero-stakes indie game; expect under 10 players per day. We want to avoid setting up a whole auth system or requiring email addresses, etc. Using a simple unique ID allows exploits (e.g. clear browser data and double-vote) but we'll assume nobody does that. Version the database and roll back manually if needed. If the game becomes popular enough to need more than that, upgrade to a more robust system.
* DEFER For community puzzles, organize them automatically by their set of allowed components. Unlock each after the earliest built-in progression point where all of those components have appeared in that group or an earlier group.
* DEFER Add histograms on the puzzle solution result modal. Rate solutions by percentile as coal, iron, gold, mithril. On the puzzle briefing screen, show the player's best score and percentile-mineral rank on each of the 4 metrics - for each metric, take the min/best over all their solutions. Also, if they have 2 or more solutions, the result modal should show their best score and the current solution's score for each metric, on each histogram.

Hardening:
* For built-in puzzles, store a canonical solution in a separate file, produced by scene export from the browser. Add tests that run each of these solutions and check that they actually succeed. Helps avoid regressions that make puzzles unsolvable.
* Try to do some fuzzing to find crashes or undesirable behaviors. There may be edge cases involving things like pistons welded to other pistons and magnets, etc. Could also check for cases of machines that can fly/levitate, or produce blocks endlessly, though those should not be "fixed" until we've looked at them manually to decide whether they should be considered bugs or features.

Components useful for designing puzzles in-world:
* Add a dispenser component that dispenses a copy of the block behind it, creating the duplicate in front of it, when it receives a charge on the side. Only dispense if the forward cell is empty.
* Add a signal-monitor component, and ROM-grapher component. In the puzzle screen, if the board has any of these components, show an additional panel on the right that displays a readout of the signal received by the signal monitor every tick, and the values in any ROM adjacent to the ROM-monitor. This is for puzzles - we can show the signals that the player will receive, the signals we expect them to output, and the actual signal they emit, similar to a Zachtronics game. Later also add configuration panel to configure these, e.g. to name the line displayed on the UI. See `~/Downloads/uvsnirmana-02.jpg` for example UI - we want something similar to the region on the right side of the screen. Each monitor is displayed as a single vertical line, with lines parallel to each other. Along each line, we color the line blue, red, or grey, dependent on the signal value. For live signal monitors, the Y-axis is time flowing downwards; for ROM-graphers, the Y-axis is index in the ROM storage.

Components:
* A sensor that detects when the sensor's own tile moves, and outputs +1 on that side, -1 on the other side.
* Comparers: compare front neighbor to back neighbor, and output +1 on sides if they're equal, else output 0.
* Assemblers that convert a group of blocks welded in a specific way into one block. For example iron and copper blocks welded in a specific way are converted to a piston block. We also want this to be able to convert one block to multiple (unwelded) blocks - so need to store a queue of blocks to emit, emit them one-by-one when the output tile is empty, and prevent the assembler from running when the queue is non-empty or over some limit.
* Assembler should match output rotation to input rotation.
* Flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide/overlap other blocks.
* Laser splitter: splits everything in a line.
* Component that rotates a neighboring block or body around itself.
* Add a fragility flag to tile kinds, and set it to true for glass blocks. A fragile block with no welds that drops and then stops falling should be deleted (later animated with a shatter effect). Maybe don't break if it fell only one tile before stopping; would require storing I think two bits per fragile block, for whether it fell in the previous tick and whether it'll shatter on stopping. Could create interesting puzzles like lowering them one block at a time with pistons, or welding before dropping and then unwelding.
* Add a press/stamper/crusher. Behaves similarly to the piston, but (1) if piston extension is blocked by another tile, and that tile can't be moved, it instead unwelds and destroys that tile; and (2) we have a list of recipes for transforming the tile that the extended arm touches, on extension.
* Grinder blocks that process a block in front into a product block - exactly like the furnace, but with a distinct table of recipes and different appearance (and later animation and sound).
* A drill/destroyer block that destroys the block in front of it.
* Add an indestructible flag. Blocks like crushers and drills should not be able to destroy these. Needed to prevent some exploits when solving puzzles, e.g. by drilling into the ground and activating the victory block.
* Replace the current magnet with an electromagnet. Positive and negative charges make it switch polarity; opposite sides have opposite polarity. Both nonzero polarities stick to iron. Like magnet sides repel, opposite magnet sides attract.
* Maybe add static non-controllable magnets, which are also non-directional.
* Component that makes its entire welded body immune to gravity. Can still be pushed down by an independent body on top that falls under gravity.
* Furnaces could have special behavior if said neighbor is surrounded by certain other neighbors.
* Furnaces could trigger a block to weld to neighbors after cooking it.
* Furnaces could have stages, e.g. cookie dough -> cookie -> burnt cookie, creating timing challenges.
* Make the glass block look transparent. Add a transparent flag in the tile definition. Make the sensor not detect transparent blocks.
* A rotator component. It has a circuit input on one back side. It faces in a specific direction, but stores an internal direction that's either forward, left, or right, indicated on the rendered block; cannot face back to the circuit input. Signals of +1 and -1 rotate that internal direction by 90 degrees at a time. Each time it rotates, it also attaches to the block in that direction, and then rotates that block's entire body to keep that edge against its new internal direction. If the body can't be moved like that due to collisions, instead block rotation.

Performance:
* Profile to determine if there's any need to optimize, and if so, what to optimize.
* Check if we're caching connected/welded bodies, or flood-filling every frame. Can easily cache it and update only on the infrequent weld/unweld operations.
* Mark some tiles or regions as asleep, if they have no updates. Wake up only regions where things are happening. E.g. a static structure made of only solid no-action blocks doesn't need to be processed every frame, doesn't need to re-check gravity every frame, etc.
* Cache circuit networks instead of rebuilding every tick.
* Maybe: Compute the next simulation step async, while the last update is still being animated. Would improve performance if simulation step time grows to exceed frame time.

Circuit network:
* Figure out how to handle wires that become split or welded together while a game runs. May already be handled correctly.
* Maybe add min() and max() gates.
* Implement a "rune array" component for miniaturizing circuits. When placed, or when clicking on the array with array tile selected, or when pressing E key with mouse over it, open a modal box that allows configuring it by placing "miniature" components on a 5x5 grid "inside" the array. The 4 edge-center tiles of the array's grid are logically connected to the rune array's 4 sides. Display the E-key configuration modal as a small grid where any component can be placed using the same palette panel used for the main grid. In the configuration modal, show the 5x5 grid, plus 4 conduits just outside it at the edge centers to show the external connection.

Circuit network design problems to try, to decide whether we should add components or change behavior:
* Maybe write a script (as TypeScript, or a Python script) that exhaustively enumerates possible combinations of components and checks whether all functions of up to N ternary inputs to M outputs can be realized using up to T components, and lowest delay with which it can be realized. Maybe assume no connectivity constraints, i.e. components are just no-position functions where anything can be wired to anything. Later maybe extend to sequential logic patterns.
* Try to design a minimal circuit that maps +1 to +1, 0 to -1, and -1 to anything. For example, this arises if we want a sensor system that outputs -1 when it's not detecting something. If this is complex / requires many components, we could add a component that makes it easier. Currently we can do this using a combiner with inputs (X, X, fixed -1), but this requires at least 5 components (fixed +1, inverter, 2 wires, combiner) which feels excessive. Could make the fixed charge configurable between +1 and -1 to eliminate the inverter. Could modify the sensor to output -1 when it detects nothing, and then passing that through a rectifier would recover previous behavior using only 1 additional component.
* Try to design a minimal circuit that can convert a sequence of charges like "-1 repeated N times (for N ticks), then 0 for one tick, then +1 repeated N times, then 0 for one tick, then repeat" into a sequence "-1 repeated N+1 times, then +1 repeated N+1 times, then repeat". If it requires say 4 or more components, then consider adding a component to make it easier. Currently it can be done using 2 combiners - one just delays the signal by 1, and the second combiner adds current and previous value; this needs around 4 components (though 2 are just conduits), and introduces a 1-tick lag. Is a better way possible?
* Similarly check how hard it is to do XOR-like operations (e.g. check if two ternary inputs are different, or check whether a set of 3 inputs contains both +1 and -1). Maybe add min/max components if these are hard.
* Similarly check whether we can compute a min or max of 2 or 3 inputs, compactly.

Don't add, for circuit network, because they can be built from a few existing components:
* AND/OR, NAND/NOR. (Maybe add min/max, though.)
* Edge detectors: can be done by using an inverter to get `-x[t-1]` and using a combiner to add `x[t] - x[t-1]`.
* Latches: can be done by connecting a combiner's output to its input.
* Block that writes alternating red/blue charges every tick. Because we can create this with a spark plus inverter feeding itself.
* Absolute-value, i.e. mapping +1 to +1, 0 to 0, and -1 to +1. Because a multiplier `X * X` does this.
* Don't extend the set of charges (0, +1, -1) to add orthogonal +i and -i charges, or add a 2-wire tile with components for reading the different wires. We'll rather keep the current ternary system since it creates interesting challenges for signal routing.

Game feel:
* Try out alternate easing for movements. Maybe define per-block easing.
* Add sounds. On block placement/removal, welding/unwelding. On victory block triggering.
* Add blocks that play a chime or other sound when charged.

UI:
* UI for creating multiple test cases for a puzzle. Needed so that we can create and export puzzles efficiently.
* When saving an image using the image button, crop out parts of the screen that are over the background, outside the grid, if this can be implemented easily.
* Implement undo and redo when editing.
* Check for any potential bugs caused by listening only to mouse-up and mouse-down events, and assuming the mouse button is held down until a mouse-up is received. Can cause accidental deletion or placing of tiles if the mouse-up event is hidden by other window events.
* Add step-forward and step-back to the control panel at the bottom. Requires keeping previous state in memory, or several so we can step back multiple ticks.
* Add hotkeys for game controls: step-forward, step-back, reset, clear, and speed controls.
* Show current total price in the control panel. Animate text like "+2(gear symbol)" rising off it as components are placed.
* Add shift + mousewheel to scroll through palette entries.
* Middle-click on palette should act like left-click on palette.
* The charge sensor rune should not allow circuit connections on the side it's facing, because that connection doesn't do anything. It should allow welds, but not connect to circuits on that side.
* Add support for mobile and touch screens. Check if it's playable.
* Modify sizing to make things more visible on 4k monitors. For example the prices of components are currently displayed very small in the inspector. Might also be an issue on 1080p though, so this may be a general sizing issue rather than UI scaling.
* In the sandbox, instead of showing `0 (gear symbol)` next to components, show nothing, because prices don't make sense for the sandbox.
* Add a settings menu accessed from the main menu.
* Settings menu: Add color-blindness options for people who can't distinguish red and blue circuit wires. Maybe just let them specify colors (from a short menu) for charges +1 and -1.
* Settings menu: Add option to clear all puzzle solutions and other saved state. Keep the user's UUID.
* Settings menu: Add a button to download all player data (everything in localStorage), and a button to import that, so players could transfer data to another device.
* On the puzzle results screen, add a button to go directly to the next puzzle's briefing screen - if the solution succeeded, and there's a defined next puzzle, and it's unlocked. Display the next puzzle's name. This is meant to help reduce menu navigation needed when we have several easy tutorial puzzles in rapid succession.
* Show a small icon to the right of the cursor, for the currently-selected tile or tool - the weld icon, the "place player-modifiable regions" tool icon, and the icon for a tile. When ctrl is held down (to weld), it should switch to the weld icon.
* Make the palette panel resizable. Modify the icon sizes, shrinking them as the palette becomes narrower.
* On puzzle and sandbox screens, move the puzzle title and the back button to the bottom-left, on the bottom bar. Currently they're at the top of the palette panel.
* Add info button, next to the game control region (with the puzzle name, goal text, and button to go back to menu / puzzle briefing). When clicked, this should open a modal that shows the puzzle name, description, and goal, and later maybe an extended description and some art, etc. Remove the goal text currently in that region. Also we'll move that game control region to bottom-left - it's a separate todo above.
* When solving a puzzle, in the game control region, show the current total price and footprint, e.g. "5⚙ | 4×5". When the mouse is held over the price, modify the palette to show prices over each component. Update when a block is placed or removed. Don't show in the sandbox.
* For the ROM's configuration modal, allow click and drag to set multiple cells. Add three buttons to fill with red, blue, or black.
* Allow mirroring components with some hotkey. Because we want to allow mirroring selections, and components like flippers. But this probably currently breaks things like ROMs which do not have mirror symmetry. Also check all components for any that have rotational asymmetry that may cause a rotated machine to behave differently, e.g. ROM cursor's wrapping behavior may break rotational symmetry.
* If the player tries to place a block, or weld, and we don't allow it, indicate the reason. (1) If it's because they're testing a puzzle, flash the reset button. (2) If it's a weld or tile edit outside the allowed region, flash the region red. (3) If they're trying to weld a block that can't be 

Selection tool:
* DEFER Maybe support selections that are a union of rectangles, created by shift-LMB-drag.
* Add a way to save a selected region in a list of saved snippets/machines, and import from that. Make it usable for transferring partial machines from one puzzle solution to another. Requires a snippet manager button and collapsible panel. Store snippets globally per user, not per puzzle.
* DEFER In the snippets panel, add buttons to delete a snippet, and import/export (maybe the same as the scene format, or a different format).

Visuals:
* Re-theme the entire game's UI. The current palette (black, dark blue, cyan, yellow) doesn't really fit the theme. Prefer colors like earth brown, stone gray, bronze, gold. Maybe: 312312 (brown), 4B5052 (grey), F1CC38 (gold), 5C718C (blue).
* Make nice panel outlines with corner decorations, gilded Art Deco style.
* Add a dark/light mode toggle. Set to dark by default, or browser default.
* Add backgrounds for puzzles, maybe with parallax as the player pans.
* For the piston base block, don't show the small rectangle that's meant to represent the head/arm of the piston. Only show it on the combined / retracted base+arm block, and on the extended arm block.
* Mark the "wire crossing" tile in a way that makes it apparent it's a wire-crossing block regardless of how many circuit connections it has. Currently with one wire, or two opposite-side wires connected, it looks like a conduit block except for the background color. Maybe draw the central cross regardless of how many sides are wired.
* Replace the current rune icon set with more intuitive or pretty symbols, matching the rune theme. Make stone/glass/platform have two parallel lines instead of the Z-lightning-bolt. Block sensor should have angular rune-like eye symbol (hollow diamond with center diamond for the pupil); charge sensor should be the same eye with lighting bolt replacing pupil. Fixed charge should have 3 lighting bolts, not plus symbol and circle. Inverter should be "hagalaz" N/H symbol. Subtractor should mark back with a small plus. Rectifier should be "thurisaz" `|>` instead of current `>|`. Victory block should have "jera" rune symbol. Magnet should be reworked, but defer until we change its mechanics. Also give them sensible background colors, e.g. shades of purple for all sensors, teal/blue for all 3-input mathematical transforms.
* Rename runes; prefer metaphorical, arcane, or Anglish-style names. ROM rune -> rune of wisdom, sensor rune -> watchful rune, inverter -> gainsayer rune, delay rune -> recall rune, rectifier -> rightener, etc. Maybe rename +1, -1, and 0 to right, left, and center, or some other natural ternary system, if we can find a way to explain sum, multiply, and subtraction concisely in that system.
* When placing welders/splitters, show additional bars for where the welds/splits will happen.

Animations:
* Animate when joints are welded or split, including by the welder/splitter components.
* Improve piston extension/retraction animation.
* Add animation for the delivery box - animate tiles moving into it, and shrinking, as they're absorbed.
* Animate fragile blocks shattering.

Larger projects, DEFER to later or never, and break up into tasks:
* DEFER Add a hexagonal variant. All tiles become hexagons. Most of our code probably still works, though using 6 neighbors instead of 4.
* DEFER Add a system of mechanical devices, a bit like our current ternary circuit system (conduits, inverter, etc.) but with different visuals and different mechanics. Since the game is 2D, we're restricted to motion that's legible in 2D - so use chain drives rather than driveshafts. Add chain drives that can rotate clockwise (+1), counterclockwise (-1), or stay still. Add gears (closer to one edge of the cell) that rotate in the inverse direction from that cell. Tint rotating components blue/red to make charges more visually distinct. Add equivalents for our runes: sensor rune becomes pressure plate, inverter is just a gear, wire-crossing is crossed chains. Others I'm not sure about: combiner, rectifier, multiplier, subtractor, sensor, selector. Also motors and generators to convert between runes/conduits and these clockwork components. We may add this as a later alternative to runes and conduits, for additional challenge.

Puzzle ideas:
* DEFER Blocks that set specific rules, e.g. what can be smelted to what. Allows puzzles in the vein of Baba Is You, or just more freedom in puzzle design. Advanced puzzles could involve changing the rules physically on the game board. Maybe have a "rule" block that looks like an arrow. Can be configured to set furnace recipes, grinder recipes, assembler recipes.
* Count up to N pulses from two separate sources and decide which source gave more pulses in total. One solution idea: use a counter block, with an inverter on one of the two inputs, and then check whether final value is positive or negative? But wrap-arounds are possible, so maybe use spark blocks to initialize it to N. Also we can't read the value of the counter block directly, would need to decrement it until it reaches zero and compare number of decrements to initial value; but that seems like almost the same problem we started with?
* DEFER Copy any puzzles from The Witness that we can recreate in this game. Add components if necessary.