Tasks that are not actionable yet / lower priority / speculative have been moved to todos-deferred.md, along with notes about features we've decided not to add.

# Authoring tools and player-created puzzles

* Add community puzzle browsing and solution-mode play of downloaded shared puzzles. Published files can currently be downloaded and imported into sandboxes.
* Allow voting community-created puzzles up and down. Assume users aren't malicious; we'll upgrade to a more secure backend if it's ever necessary. Use the existing installation UUID. Browser-level site-data deletion can still create another identity, but the game's clear button preserves it and full player-data import/export transfers it.

# New non-circuit components

* Add a dwarf block which is breakable - anything falling onto the dwarf block should destroy it. Anything pushing the dwarf block should push it, unless the push is blocked by something on the other side like a wall, in which case that should also crush the dwarf. Use the shattering animation for this.
* Add a gravity stone that changes its welded body's gravity to point in the gravity stone's forward direction, instead of downward.
* Add a molten copper block, which is unweldable and falls diagonally like sand. Make the furnace convert copper blocks to molten copper after a delay. Molten copper that stays unmoving for say 3 ticks converts back to copper blocks, and welds itself to all neighboring copper blocks (or other copper that was created by molten copper solidifying in the same tick). Requires a new mechanism for tracking blocks that convert to other blocks when stationary; a bit like how fragile blocks can shatter if they fall a certain distance onto ground. This allows for interesting puzzles based on pouring copper into molds to create complex shapes. As follow-up, add the same mechanism to other metals - probably gold/tin/silver can melt, but not iron/steel/bronze/mithril, so each metal has different constraints.
* Add a riveter block. Similar to a welder block, but welds the one edge between its two front neighbors.
* Add a gate block. When it receives a charge on left/right side, it moves the body above it to below it, mirrored. We have this functionality already with the duplicator block; the only difference is that it also consumes the body above it, unlike the duplicator. (And different visuals.) Useful for puzzles where the player has to build intermediates in different isolated compartments.
* Add a forced-flipper block. Similar to the existing flipper block, but instead of checking for collisions and then blocking the flip, it instead always flips, destroying any blocks that would collide with the flip. Useful for creating some puzzle infrastructure.
* Add a bomb block. When it receives a circuit charge, it detonates, filling the 3x3 region around itself with fire blocks, replacing whatever blocks are there currently. Except don't replace indestructible blocks.

# Component behaviors

* Modify the assembler to add a pushing force for output: When it has a pending output, but no space to output, attempt to push the blocks away so that it can produce output; failing that, try to push the assembler itself in its forwards direction, so the product can be emitted out the back (at assembler's pre-movement position) in the same tick.
* Modify the duplicator in the same way as assembler above - make it also attempt to push itself away from the output side, if it's trying to duplicate a single-tile body but there's something blocking the output. When duplicating multi-tile bodies, don't do this - require already empty space for the whole body.
* Potentially allow configuring the initial state of stateful blocks like the rotator (initial head facing) and piston (whether to start expanded or retracted), maybe using some hotkey to toggle. The rotator's initial head direction determines which side can be welded to. For the piston, things like the cost of all placed components is a bit weird; may have to add a special case like piston heads and bodies each having half the price of ordinary retracted body-and-head piston blocks, but still hide body and arm separate blocks from the palette.
* Bug: currently a magnet cannot pick up an iron block, and a metallic arm cannot pick up a magnet. Magnets only seem to prevent falling. They should behave more like there's a weld between two blocks if one is a magnet and the other is magnetic. (But not exactly like a weld; for example a vehicle should be able to stick to a metal wall using a magnet, while also driving up and down using a conveyor; or stick to the bottom of a ceiling and drive left and right.) Similarly a magnet stuck to the top of a horizontal iron bar should move with the iron bar if the bar moves left and right, or move with a wall that moves up and down. General rule is probably: act like a weld, except if there's a non-gravity force trying to move it along the axis perpendicular to its facing, in which case it should still be movable along that axis.
* Modify splitter, welder, laser splitter, and dismantler: only split/weld on +1 signal, instead of being enabled by default and disabling on -1. May break some current reference solutions.

# Performance

* Follow the current performance plan `docs/performance-todos.md`: refresh end-to-end browser measurements, investigate active fitted rendering, and measure retained session memory before choosing further optimizations. The original profile and completed optimization log are archived in `performance-history.md`.
* Figure out why our game has high CPU usage currently, and whether we can reduce that (e.g. for battery life on laptop and mobile). The geode bench scene currently uses around 100% CPU while running, on Firefox. Update: we've partially addressed this by not repainting stationary frames, and not animating when paused (by default); but running games with moving parts still use around 100% CPU due to redraws.

# UI

* When using the "download scene file" and "download image" buttons in the puzzle workshop, give the downloaded file a name matching the puzzle's name or ID, instead of `factory2d-scene.json` and `factory2d-grid.png`.
* Add support for mobile and touch screens. Figure out what changes we need and break this up into more actionable tasks. (For example rotation and configuration currently require keyboard. And in the workshop, the palette panel takes up the entire left half of a vertical screen - move to top of vertical screens, maybe make it collapsible.)
* Modify our game's color scheme, for both light and dark mode. Sample colors from the background image and use those.
* Add some decoration for the puzzle workshop screens where blocks are placed. Maybe a different background, or some other kind of decoration.
* On mouseover of a rotator block, if its head is welded to something, show visualization of how it would move under +1 and -1 pulses, in place of the current mouseover visualization (which shows movement for a 1x1 block).

On score histograms
* Bug: after mouseover of any bar, the mouseover data (like "Score = 36: 1 player.") never goes away - they never register as un-hovered. If there's one bar, this applies to 
* The readouts like "Score ≥ 151.75 and < 151.83333333333334: 0 players." can be made more compact. Limit to say 2 digits after decimal point.
* Currently "PRICE" is on a separate row from "Local best" which is on a separate line from "151" (the local best number). Change it to something more compact like "PRICE" and then at the right of that same row "151" (the local best number).
* Remove the "Lowest submitted: 152" line. Maybe show it on title text of the player's best score like "Your best: 151. Global best: 152."
* This example above also shows there's some bug with how we're computing or submitting histogram scores. Currently if I go to `https://stephen6174.itch.io/dwarfworks` in my Firefox window (with my UUID), and navigate to the Copperworks puzzle, it shows my local best price as 151 but histogram says it's 152; and for footprint it says my local best is 50, but histogram shows a bar (1 player only - me) in the 55 bucket, and lowest submitted as 55.
	* On running the test, says "Saved locally; score not submitted. Complete another test run to try again. Community scores: — 1 player." This is probably the cause? Seems that submitting community scores gets HTTP 400 from the server. Specifically the response has error `error "Submitted combined score is inconsistent"`. Maybe the combined score submission is assuming a single solution provides all of the metrics' best, which isn't true.
* In the `.test-report-dialog`, the score histograms take up a lot of space. Can we make all these histograms shorter vertically? They can still be verbose on the puzzle briefing page.

# Content

Ideas and puzzle list moved to `puzzles.md`. We have enough tutorial puzzles. We need to add more actual puzzles, at a range of difficulty levels. Before adding any puzzles, read that file, and keep it updated with new puzzles added.
