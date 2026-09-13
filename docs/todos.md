Tasks that are not actionable yet due to prerequisites, or are lower priority, are marked as DEFER.

# Game flow

## Sim test/play flow

* DEFER Maybe add a step-back button to the control panel at the bottom. Requires keeping previous state in memory, or several so we can step back multiple ticks.
* DEFER If we do the "asleep vs active regions" optimization below, or if we store previous state for step-back, then as a follow-up: when testing a solution, check for loops (no active regions, or previous state equals current state) and end the test early.

## New puzzle types

* DEFER Add support for a new puzzle type, where the player starts with a machine that doesn't work. They have to modify as few tiles as possible to make it work. Same scoring rules but we only count modified tiles. Add some way to view what tiles have been modified - maybe color grid lines yellow if their contained cell is modified.
* DEFER After the last set of puzzles is unlocked, also unlock a "full toolbelt" equivalent of every puzzle - a variant where all components are available, with the same list of prices for each. This adds content, lets players compete on more histograms.
* DEFER Add a variant of puzzle pricing, where instead of a price per block, you have a fixed number of each block, shown on the palette. Allow placing more than that, but show warning in bottom-left if puzzle exceeds allowed amount, and don't register success or entirely block testing.

# Storage format, import/export

* DEFER Further compact orientations and charges in the scene and tutorial export/import formats, possibly storing charges per network instead of per tile. More complex per-tile state (e.g. furnace stored ticks or target/delivery-block configuration) can remain verbose. Only include full ASCII grids for fields that aren't empty / default value everywhere.

# Authoring tools, player-created puzzles, histograms

* Add back-end server and database. Probably Cloudflare Workers + D1 + R2. Then make the game request histogram data and (later) shared puzzles, and allow submitting scores and shared puzzles. Use `crypto.randomUUID()` to assign each install an ID.
* DEFER Allow voting community-created puzzles up and down. We can assume users aren't malicious, this is a zero-stakes indie game; expect under 10 players per day. We want to avoid setting up a whole auth system or requiring email addresses, etc. Using a simple unique ID allows exploits (e.g. clear browser data and double-vote) but we'll assume nobody does that. Version the database and roll back manually if needed. If the game becomes popular enough to need more than that, upgrade to a more robust system.
	* Also, when using the "clear all player data" button, do not erase the UUID. Unclear what we should do when importing/exporting - maybe transfer the UUID.
* DEFER For community puzzles, organize them by their set of allowed components. Unlock each community puzzle group after the earliest progression point where all of those components have appeared in that group or an earlier group.
* Add histograms on the puzzle solution result modal. Rate solutions by percentile as coal, iron, gold, mithril. On the puzzle briefing screen, show the player's best score and percentile-mineral rank on each of the 4 metrics - for each metric, take the min/best over all their solutions. Also, if they have 2 or more solutions, the result modal should show their best score and the current solution's score for each metric, on each histogram. The histograms for each metric should use data from each player's best solution on each metric to that puzzle - so we'll need to remove the old value and add the new value.

# New non-circuit components

* Flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide/overlap other blocks. Similar to Kaizen game's rotation.
* Add a bell block that plays a sound when it moves left/right (but not when moving up/down). Add configuration dialog to choose the pitch and maybe sound type like sine or triangle. Also add a resonator rune with matching configuration, which emits a charge when a matching bell rings, anywhere on the grid.
* Add a thruster component that has no gravity, and moves forward one tile every tick. When blocked, attempt to push the tile in front.
* Add a slider component that cannot be moved in one axis, only the other axis. Allow rotation, which changes which axis is fixed. A welded body with sliders has all of their constraints - so with both horizontal and vertical sliders, it can't move at all.
* Push-at-a-distance block - on receiving a rear input of +1 or -1, find the first nonempty tile in a straight line from its forward face, and attempt to push or pull that body.
* Block that disables gravity for the first body seen in a straight line in its forward direction.
* DEFER Add a press/stamper/crusher. Behaves similarly to the piston, but (1) if piston extension is blocked by another tile, and that tile can't be moved, it instead unwelds and destroys that tile; and (2) we have a list of recipes for transforming the tile that the extended arm touches, on extension.
* DEFER Add an electromagnet, and rework the current magnet block. Positive and negative charges make it switch polarity; opposite sides have opposite polarity. Both nonzero polarities stick to iron. Like sides repel, opposite sides attract, any any side is attracted to neutral magnetic blocks like iron. Maybe add static non-controllable magnets, which are also non-directional.
* Block that destroys blocks moved onto its tile. For example, a 5x5 body falling onto one drill block should be cut in half. Once we have the flipper block, also allow flipping bodies onto this block, which destroys the blocks that overlap it. Unclear what behavior we should have when rotating bodies onto it; maybe count it as colliding / preventing rotation onto it.
* DEFER Add a "box" component that has an internal grid of miniature components. Similar to the implemented rune array (reuse its nested `World` state, `WorldRuntime` tree, entering/leaving view, and nested board format), but instead of circuit signal ports, add holes where blocks can fall in/out or be pushed in/out. A miniature block that falls out through a hole becomes a full block on that side of the box; a full block that falls in becomes a miniature block. Similar to Factorio's warehouse mods, or Patrick's Parabox.
* Add a magic link block. Whenever two link blocks are in the same row or column, they count as part of the same welded body for all physics/sim purposes. These allow creating single bodies that have holes in them through which things can fall.

## Blocks we could add, but probably shouldn't, rather build from existing tools

* Linear actuator or drive collar. Like a piston that can extend multiple tiles long - we have a rod below and above the drive collar, then a charge causes it to consume from one side and add on the other side. Don't add, because we can build this using a conveyor belt moving the rod.
* Lock gate block - consume body in front and output it on the other side flipped, on receiving a charge. Rather don't add, because we can build this 
* Magic barrier beam block - rather use pistons to create a physical barrier.

# New component behaviors

* Fully support mirrored components. We have tools to reflect a copy-pasted group, but they don't actually mirror components. Later we also want to add machine blocks that can flip bodies. Currently, flipping horizontally, a left/right-pointing selector rune is currently rotated 180 degrees, and up/down-pointing ones are not rotated, which is correct for some components like a combiner or inverter that have bilateral symmetry. But components like selectors, ROMs, and laser splitters are not symmetric under reflection around the front-to-back line.
* Add a fragility flag to tile kinds, and set it to true for glass blocks. A fragile block with no welds that drops and then stops falling should be deleted (later animated with a shatter effect), unless it fell only one tile before stopping; would require storing additional data per fragile block. Most blocks won't be fragile so this is fine. Could create interesting puzzles like lowering blocks one tile at a time with pistons, or welding before dropping and then unwelding.
* Modify the assembler to add reaction force: When it has a pending output, but no space to output, shift the assembler in its forwards direction, emitting the product out the back (at assembler's pre-movement position). Allow this motion to push other blocks that are in front of the assembler.
* Modify the duplicator in the same way as assembler above - make it also attempt to push itself away from the output side, if it's trying to duplicate a single-tile body but there's something blocking the output. When duplicating multi-tile bodies, don't do this - require already empty space for the whole body.
* Audit components that can move blocks for behavior when multiple are linked together. For pistons, we added dependency-ordered substeps to allow a tower of linked pistons to resolve in one tick. But rotators and maybe other components may need similar changes.

# Performance

* Optimizations noted in `docs/performance-todos.md` - some have been completed and greatly improved performance.
* Profile again after doing those already-noted performance tasks, and determine if there's any need to optimize further, and if so, what to optimize.
* Mark some tiles or regions as asleep, if they have no updates. Wake up only regions where things are happening. E.g. a static structure made of only solid no-action blocks doesn't need to be processed every frame, doesn't need to re-check gravity every frame, etc.
* Cache circuit networks instead of rebuilding every tick.
* DEFER Compute the next simulation step async, while the last update is still being animated.
* Potential issue later: we may have very large connected bodies. For example a puzzle in a 400x300 map almost entirely filled with welded stone blocks, where the player needs to build a mining machine. Every time they mine one block, that entire welded body changes and may trigger work to update its entire border. We might need to split the body into chunks and make separate paths for their borders, meeting at the chunk boundary, or something like that.

# Circuit network

## New circuit components

* Add a sensor that detects when the sensor's own tile moves, and outputs +1 on that side, -1 on the opposite side.
* Add a "rune engine" component that's like a programmable gate array. Take 2 inputs and produce 2 outputs. The block should be configurable to determine the I/O relation from some possible set. Details TBD. Could include an internal latch for feedback, like the PGA in Shenzhen IO. Visualize the engine block as a variation on the existing "rune array" component, but with a specific pattern of pre-set runes inside it, which cannot be modified except by toggling them between some specific states on click e.g. conduit vs stone block, or rotating by 90-degree increments.
* Add a stack block with push/pop to store data up to some max size. One input for value to push - always push if it's +1 or -1, but ignore zero. One input to trigger a push on +1, pop on -1. One output for popped value. One input to rotate it forwards or backwards on +1 or -1.
* Add a queue block, similar to the stack block.
* Add a delay block, but instead of advancing 1 space per tick, it advances when an additional input is +1. Maybe also allow -1 to scroll back. Uncertain, this seems similar to the queue block.
* Add a delay block variant that only steps forward if the input is +1 or -1, ignoring zeros. Like the current delay block, on every tick, it outputs the queued value; but we only shift the ring buffer forward and write a value when the back value is +1. Uncertain, seems similar to the queue block.
* Figure out what components are necessary to build a version of the 2D ROM that exists in-world. What components are necessary? Maybe create an NxM block of ruby and sapphire blocks, and then add components needed to read a specific coordinate, or to advance one reader up/down and another left/right and then a way to read the intersection. Perhaps a variant of the beam block types, which can duplicate a block at the intersection of two perpendicular beams? Or physically shifting rows of gemstones from bottom to top or left to right.

# UI

* Add various animations for clicking buttons, placing blocks, starting a puzzle, etc.
* Implement undo and redo when editing.
* Add support for mobile and touch screens.
* Allow mirroring components with some hotkey. Because we allow mirroring selections, and we'll add components like flippers. But this would currently break blocks without bilateral symmetry, like ROMs and selector runes.
* DEFER Maybe support selections that are a union of rectangles, created by shift-LMB-drag.
* Modify welding with the mouse. For example, if I have a 2x10 column, I want to be able to easily weld/unweld each 2x1 horizontal brick along the edge between horizontal neighbors, without also welding any vertical neighbors, by holding Ctrl key and dragging the mouse. Currently this is difficult because if the mouse is slightly horizontally off the center-line, it causes vertical neighbors to be welded. Basically introduce a dead zone in corners where 4 blocks meet; in those corners, make weld input cause no weld to occur. Also add a dead zone in the center of each tile. So the non-dead zone for a given weldable edge is close to the midpoint of that edge.

## Puzzle briefing screen

* DEFER Later instead of a gold highlight, choose color according to a grade decided by percentile on the histogram - iron, gold, diamond, mithril. Also, on the main menu, color completed puzzles' buttons by the grade of the player's best solution.
* DEFER Also style the 4 scores of each solution according to their grade in the histogram for that specific metric.
* DEFER Add text and art in the puzzle briefing - write a story to explain why the player is solving this puzzle.

# Visuals

* DEFER Add background art for puzzles. Maybe caves, multiple layers, with parallax as player pans.

## Specific block appearance changes

* DEFER Rework magnet artwork alongside the planned electromagnet mechanics.
* DEFER For the rotator component, we should modify rendering to make behavior more obvious. Maybe draw as a welded block with only around a third of the width, on welded side, and then draw the rotator arm separately. Also mark red/blue on the sides of the base to show which charge rotates in which direction.

## Animations

* Add animations for processing blocks - furnace, drill, grinder. They should indicate on the block that they're baking/drilling/grinding with an overlay showing progress.
* Add animation for the delivery box, assembler, duplicator, lock gate. When they consume a body, animate the body shrinking, moving towards the block, and lowering opacity until it vanishes. When they produce a body, animate the opposite.
* Animate fragile blocks shattering - maybe split them in half across say a line at 30 degrees from vertical, then animate the halves moving apart and fading out from one tick to the next. Also use the same shatter animation for blocks broken by mining devices, fasteners that break, etc.
* DEFER Interpolate movement inside a rune array while its contents are displayed and the array itself moved in the same tick: the nested previous world is matched by ID path, which works, but a resized array yields no interpolation source for that tick.

# Larger projects, DEFER to later or never, and break up into tasks:

* DEFER Add hexagonal grids for some puzzles.
* DEFER Add a system of mechanical devices, like our current ternary circuit system (conduits, inverter, etc.) but with different visuals and different mechanics. We're restricted to motion that's legible in our 2D side view. Add chain drives that can rotate clockwise (+1), counterclockwise (-1), or stay still. Add gears that rotate in the inverse direction from a neighbor, and equivalents to other rune/circuit components.
* DEFER Blocks that set specific rules, e.g. what can be smelted to what, or what the assembler recipes are. Allows puzzles in the vein of Baba Is You, and more freedom in puzzle design.
* DEFER Add elf archers with some simple behavior. Add arrows that they can shoot, which arc up for 2 tiles diagonally, then travel to the side and destroy the first block they hit.

# Puzzle ideas

* Count up to N pulses from two separate sources and decide which source gave more pulses in total. One solution idea: use a counter block, with an inverter on one of the two inputs, and then check whether final value is positive or negative? But wrap-arounds are possible, so maybe use spark blocks to initialize it to N. Also we can't read the value of the counter block directly, would need to decrement it until it reaches zero and compare number of decrements to initial value; but that seems like almost the same problem we started with?
* A suite of basic circuit problems, where you only have: conduit, combiner, inverter, and fixed source. Add puzzles to build most of the more advanced circuit components out of these. The combiner is effectively a sum or vote/majority rune. Combiner also gives a 1-tick delay, so you can chain them to make a machine that acts like a delay rune with arbitrary memory size. Combiner with duplicate inputs, one delayed and inverted, gives edge detection. Spark is fixed value plus edge detection. For the rectifier/diode, we have a puzzle and reference solution, which needs two combiners and a multiplier. Rectifier could also be built using two combiners, fixed source, and inverter: use fixed source and inverter to get -1, then compute `Combiner(x, x, -1)` which takes (-1, 0, 1) to (-1, -1, 1), and then combine that with +1.
* Physically reverse a list: The player's machine receives ruby blocks and sapphire blocks in some order; they must be output in reverse order. Requires building a physical contraption that behaves like a push/pop stack, or maybe putting them in a box and physically rotating it. The player presses a button to receive the next block, and we drop a stone block (or pulse a signal) to indicate the end of the sequence. (How do we build the infra to test? Maybe a delivery box, swapping which block is below it. Or maybe use block-comparer to produce +1 and -1 charge for each one received, and then compare sequences omitting zeros. Or maybe put the entire sequence we expect on a conveyor belt below the delivery box.)
* Physical subtraction: Receive some number of stone blocks and some number of iron blocks; output a number of blocks equal to the absolute value of the difference, then press a button to validate answer.
* Puzzle: Given a supply of sand blocks, and a conduit that pulses N times, move N sand blocks to the output, and the rest to a different output. Alternatively, provide the requested amount via a clock that pulses every N ticks; or via a few separate buttons for requesting different amounts (say 1, 2, 3, 5; or ternary -3, -1, +1, +3, +5, and if multiple are on, they must output the sum).
* Puzzle: ROM implemented in-world with basic components. Given an NxM rectangle of ruby and sapphire blocks, and circuit impulses on a given column or row, read the ruby/sapphire state at that specific 2-dimensional index. Repeat for several lookups in the same NxM rectangle.
* Receive N signals in order on the left, must be output in reverse order on right, no rune crossing blocks allowed. Reverse order meaning vertically flipped; not time reversal. We've implemented puzzles for the N = 2 case; greater N can be done by repeating solutions to those. Could have variants, e.g. inner block gives signals and outer ring must receive them after some permutation.
* Puzzle: given N circuit inputs, output the most common one among them. As a variant, give them one signal with +1 and -1 over different ticks, and they must output the modal value / sign of the sum.
* Look at other puzzle games (The Witness, various Zachtronics games, Roody:2d) for inspiration. Add any components necessary to allow implementing similar puzzles in our game. For example, we could make Witness-style mazes by letting the player place only conduits, and they have to link a fixed charge to the victory block; but how could we implement other constraints from Witness's puzzles?
* Various straightforward mechanical manipulation puzzles, e.g. given stone blocks, weld them into 1x2 bodies, or 2x2, or one of each tetromino, or shapes made of different block types in specific configurations. Could add various constraints, e.g. use lock gate pattern to enforce creating some intermediate, then unwelding that and reassembling into a different shape.
* Add a tutorial puzzle where the player can place victory blocks and inverters. Provide them with a -1 signal. This teaches how the in-world puzzle infrastructure works.
* Given rotator blocks and various circuit blocks, carry stone blocks from a low starting position to a high delivery block, by rotating them repeatedly.
* Puzzle: build a lock gate that allows through only bodies matching a specific shape.
* Puzzle: build a gantry that grabs bodies and moves them over a wall.
* PRIORITY Create a few puzzles that are actually difficult - maybe some of those above.
* PRIORITY Create a few better tutorial puzzles. Use the text box component we've added.
