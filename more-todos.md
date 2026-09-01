Tasks that are NOT actionable yet, or have prereqs, are marked as DEFER below.

Game flow:
* DEFER(until we have selection tool) Allow converting selection to the allowed placement region with a button, only in the sandbox. For designing shareable puzzles.
* DEFER(until test JSON format) Implement a text-box tool that places and edits text boxes on the game screen. Useful for tutorial puzzles, and also for players that want to label/annotate their designs. Model them separate from the component grid - they're not grid-aligned and don't occupy tiles.
* DEFER Add back-end server and database. Probably Cloudflare Workers + D1 + R2. Then make the game request histogram data and shared puzzles, and allow submitting scores and shared puzzles.
* DEFER Use `crypto.randomUUID()` to assign each install an ID. Allow voting community-created puzzles up and down. We can assume users aren't malicious, this is a zero-stakes indie game; expect under 10 players per day. We want to avoid setting up a whole auth system or requiring email addresses, etc. Using a simple unique ID allows exploits (e.g. clear browser data and double-vote) but we'll assume nobody does that. Version the database and roll back manually if needed. If the game becomes popular enough to need more than that, upgrade to a more robust system.
* Make puzzle share/save options open a modal to enter the name and description. We'll use this both for authoring puzzles easily, and for later allowing users to share puzzles to a public list of community puzzles.
* For community puzzles, organize them automatically by their set of allowed components - they should be unlocked after the first built-in puzzle which includes all of those components among its recursive prerequisites. Construct the set of "components that have been introduced so far" for each built-in puzzle by taking union of those sets for each prereq.
* Remove the "import" button on puzzles; it should only be displayed in the sandbox. It's already disabled in puzzles, but still visible.
* On puzzle and sandbox screens, move the puzzle title and the back button to the bottom-left, on the bottom bar. Currently they're at the top of the palette panel.
* For running test cases, some conveniences: Show the test cases running. Increase tick rate every n cycles so it doesn't take too long. Add a fast-forward button that runs them as fast as possible with no rendering. When a test case fails, immediately pause and show the failed state, instead of showing the results modal.
* Add a properties button, visible only in the sandbox. Allow setting the grid size. Later other things like the background image, gravity, etc.
* Edit format for scenes and puzzles: make the fields `orientations`, `charges`, `crossingCharges`, `furnaces` all optional, with default value of `[]`. When exporting, don't specify those fields if they're the empty list, which is often the case. This will reduce incompatibility when we add new block types and de-bloats the format.
* Similarly, remove the "standard" test case with no overrides - treat that as a given and only list additional test cases in the file.
* Further compact orientations and charges in the export/import format, possibly storing charges per network instead of per tile. More complex per-tile state (e.g. furnace stored ticks or target/delivery-block configuration) can remain verbose. Only include full ASCII grids for fields that aren't the default value.
* Add collapsible sections (default collapsed) on the main menu: a "credits" section (art/music credits, links to similar video games like Roody:2D, Zachtronics, Infinifactory), and a "technical info" section that explains what stack we're using, architecture, etc.
* After the last set of puzzles is unlocked, also unlock a "full toolbelt" equivalent of every puzzle - a variant where all components are available, with the same list of prices for each. This adds some content, lets players compete on more histograms.

General:
* Allow interacting with some components using a modal box. Modal is opened when placing the block (for some of them, depending on a flag) and by pressing E while mouse is over them. Show control prompt in the tile inspector panel.
* Try to do some fuzzing to find crashes or undesirable behaviors. There may be edge cases involving things like pistons welded to other pistons and magnets, etc. Could also check for cases of machines that can fly/levitate, or produce blocks endlessly, though those should not be considered bugs until we've looked at them manually to decide whether they should be considered bugs or features.

Components useful for designing puzzles in-world:
* DEFER(tile interaction panel) Add a charge counter component - counts up from zero every tick it receives a charge on the back, and outputs a charge once it reaches a configured threshold. Requires some kind of UI for setting the threshold - maybe open a modal input box once the block is placed, and when pressing the E key with mouse over the block. (We'll need similar modals for some other configurable components, like ROMs.) Render the current count on the block.
* Add a dispenser component that dispenses a copy of the block behind it, creating the duplicate in front of it, when it receives a charge on the side.
* Add ROM component: +1/-1 on one side moves cursor, other sides output the stored value, modal allows setting ROM size and value in each cell.
* Add a signal-monitor component, and ROM-grapher component. In the puzzle screen, add an additional panel on the right that shows a readout of the signal received by the signal monitor every tick, and also shows a graph of the values in any ROM adjacent to the ROM-monitor. This is for puzzles - we can show the signals that the player will receive, the signals we expect them to output, and the actual signal they emit, similar to a Zachtronics game. Later also add interaction panel to configure these, maybe.

Components:
* A sensor that detects when the sensor's own tile moves, and outputs +1 on that side, -1 on the other side.
* Welder blocks.
* Splitter blocks.
* Comparers: compare front neighbor to back neighbor, and output +1 on sides if they're equal, else output 0.
* Assemblers that convert a group of blocks welded in a specific way into one block. For example iron and copper blocks welded in a specific way are converted to a piston block. We also want this to be able to convert one block to multiple (unwelded) blocks - so need to store a queue of blocks to emit, emit them one-by-one when the output tile is empty, and prevent the assembler from running when the queue is non-empty or over some limit.
* Flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide/overlap other blocks.
* Laser splitter: splits everything in a line.
* Configurable components where the player can enter a number in a text box, e.g. a configurable-delay repeater.
* Component that rotates a neighboring block or body around itself.
* Add a fragility flag to tile kinds, and set it to true for glass blocks. A fragile block that drops and then stops falling should be deleted, animated with a simple shatter effect.
* Add a cushion flag and cushion block. Fragile blocks that fall onto a cushion block do not shatter.
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

Performance:
* Profile to determine if there's any need to optimize, and if so, what to optimize.
* Check if we're caching connected/welded bodies, or flood-filling every frame. Can easily cache it and update only on the infrequent weld/unweld operations.
* Mark some tiles or regions as asleep, if they have no updates. Wake up only regions where things are happening. E.g. a static structure made of only solid no-action blocks doesn't need to be processed every frame, doesn't need to re-check gravity every frame, etc.
* Cache circuit networks instead of rebuilding every tick.
* Maybe: Compute the next simulation step async, while the last update is still being animated. Would improve performance if simulation step time grows to exceed frame time.

Circuit network:
* Add configurable delays.
* Figure out how to handle wires that become split or welded together while a game runs. May already be handled correctly.
* Maybe extend the set of charges (0, +1, -1) to add orthogonal +i and -i charges, or add a 2-wire tile with components for reading the different wires.
* Maybe add min() and max() gates.
* Implement a "rune array" component for miniaturizing circuits. When placed, or when clicking on the array with array tile selected, or when pressing E key with mouse over it, open a modal box that allows configuring it by placing "miniature" components on a 5x5 grid "inside" the array. The 4 edge-center tiles of the array's grid are logically connected to the rune array's 4 sides.
* Add a system of mechanical devices, a bit like our current ternary circuit system (conduits, inverter, etc.) but with different visuals and different mechanics. Since the game is 2D, we're restricted to 2D motion. Add chain drives that can rotate clockwise (+1), counterclockwise (-1), or stay still. Add gears (closer to one edge of the cell) that rotate in the inverse direction from that cell. Tint rotating components blue/red to make charges more visually distinct. Add equivalents for our runes: sensor rune becomes pressure plate, inverter is just a gear, wire-crossing is crossed chains. Others I'm not sure about: combiner, rectifier, multiplier, subtractor, sensor, selector. Also motors and generators to convert between runes/conduits and these clockwork components. We may add this as a later alternative to runes and conduits, for additional challenge.

Don't add, for circuit network, because they can be built from a few existing components:
* AND/OR, NAND/NOR. (Maybe add min/max, though.)
* Edge detectors: can be done by using an inverter to get `-x[t-1]` and using a combiner to add `x[t] - x[t-1]`.
* Latches: can be done by connecting a combiner's output to its input.
* Block that writes alternating red/blue charges every tick. Because we can create this with a spark plus inverter feeding itself.

Game feel:
* Try out alternate easing for movements. Maybe define per-block easing.
* Add sounds. On block placement/removal, welding/unwelding. On victory block triggering.
* Add blocks that play a chime or other sound when charged.

UI:
* Add a selection tool, for selecting a rectangular region of tiles and copying, pasting, moving, and rotating.
* Add a way to save a selected region in a list of saved machines, and import from that. Make it usable for transferring partial machines from one puzzle solution to another. Requires a clipboard manager button and panel.
* UI for creating multiple test cases for a puzzle. Needed so that we can create and export puzzles efficiently.
* Add a way to copy selection to a clipboard, for transferring machines between puzzles.
* When saving an image using the image button, crop out parts of the screen that are over the background, outside the grid, if this can be implemented easily.
* Implement undo and redo when editing.
* Check for any potential bugs caused by listening only to mouse-up and mouse-down events, and assuming the mouse button is held down until a mouse-up is received. Can cause accidental deletion or placing of tiles if the mouse-up event is hidden by other window events.
* Add step-forward and step-back to the control panel at the bottom.
* Add hotkeys for game controls: step-forward, step-back, reset, clear, and speed controls.
* Show current price in the control panel. Animate text like "+T2" jumping off it as components are placed.
* Add shift + mousewheel to scroll through palette entries.
* Middle-click on palette should act like left-click on palette.
* The charge sensor rune should not allow circuit connections on the side it's facing, because that connection doesn't do anything. It should allow welds, but not connect to circuits on that side.
* We'll show a sidebar with all interactions relevant for a given puzzle.
* Solutions rated by percentile as coal, iron, silver, gold, mithril, etc.
* Add support for mobile and touch screens.
* Add a settings menu accessed from the main menu.
* Settings menu: Add color-blindness options for people who can't distinguish red and blue circuit wires. Maybe just let them specify colors (from a short menu) for charges +1 and -1.
* Settings menu: Add option to clear all puzzle solutions and other saved state. Keep the user's UUID.
* Settings menu: Add a button to download all player data (everything in localStorage), and a button to import that, so players could transfer data to another device.
* On the puzzle results screen, add a button to go directly to the next puzzle's briefing screen - if the solution succeeded, and there's a defined next puzzle, and it's unlocked. Display the next puzzle's name. This is meant to help reduce menu navigation needed when we have several easy tutorial puzzles in rapid succession.
* Show a small icon to the right of the cursor, for the currently-selected tile or tool - the weld icon, the "place player-modifiable regions" tool icon, and the icon for a tile. When ctrl is held down (to weld), it should switch to the weld icon.
* Make the palette resizable. Modify the icon sizes, shrinking them as the palette becomes narrower.

UI: tile inspector panel:
* Bug: the tile inspector/detail panel should show info on the palette entries while the mouse is over them, and info on the tile under the mouse when the mouse is over a placed tile instance. Currently after clicking on a palette entry, if the mouse then moves away and moves over placed tiles, it still shows the palette entry's info instead of the moused-over tile instance's info, unless the player clicks on empty space.
* Modify the inspector to show description for the tile type of a tile instance on the board, on mouseover.
* Move the inspector panel to near top-left, just right of the palette panel.
* Clean up the tile inspector panel's info shown for tile instances placed on the grid: Move tile ID to be small, next to the X and Y coordinates. Remove "movement", "weldable", "magnetic". Edit descriptions instead to note unusual values for those - sand's description should say it can fall diagonally, platform's description should say it's not affected by gravity, iron's description should say it's magnetic. Remove "welds" section since it's visually obvious, or show a simple code with arrows in the X/Y/ID line.
* Show the tile inspector panel when mouse is over a tool in the palette panel - currently only the weld tool. It should show a description of the tool and its controls (left-click welds, right-click unwelds).
* Display a small color-coded truth table on the inspector, for components where that's relevant.

Visuals:
* Re-theme the entire game's UI. The current palette (black, dark blue, cyan, yellow) doesn't really fit the theme. Prefer colors like earth brown, stone gray, bronze, gold. Maybe: 312312 (brown), 4B5052 (grey), F1CC38 (gold), 5C718C (blue).
* Make nice panel outlines with corner decorations, gilded Art Deco style.
* Add a dark mode toggle. Turn it on by default.
* Add backgrounds for puzzles, maybe with parallax as the player pans.
* For the piston base block, don't show the small rectangle that's meant to represent the head/arm of the piston. Only show it on the combined / retracted base+arm block, and on the extended arm block.
* Mark the wire crossing in a way that makes it apparent it's a wire-crossing block regardless of how many circuit connections it has. Currently with one wire, or two opposite-side wires connected, it looks like a conduit block except for the background color. Maybe draw the central cross regardless of how many sides are wired.
* Add animation for the delivery box - animate tiles moving into it, and shrinking, as they're absorbed.
* Replace the current icon set with more intuitive or pretty symbols, matching the rune theme. Make stone/glass/platform have two parallel lines instead of the Z-lightning-bolt. Block sensor should have angular rune-like eye symbol (hollow diamond with center diamond for the pupil); charge sensor should be the same eye with lighting bolt replacing pupil. Fixed charge should have 3 lighting bolts, not plus symbol and circle. Inverter should be "hagalaz" N/H symbol. Subtractor should mark back with a small plus. Rectifier should be "thurisaz" `|>` instead of current `>|`. Victory block should have "jera" rune symbol. Magnet should be reworked, but defer until we change its mechanics. Also give them sensible background colors, e.g. shades of purple for all sensors, teal/blue for all 3-input mathematical transforms.
* Improve piston extension/retraction animation.
