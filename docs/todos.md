Tasks that are not actionable yet / lower priority / speculative have been moved to todos-deferred.md, along with notes about features we've decided not to add.

# Authoring tools and player-created puzzles

* Add community puzzle browsing and solution-mode play of downloaded shared puzzles. Published files can currently be downloaded and imported into sandboxes.
* Allow voting community-created puzzles up and down. Assume users aren't malicious; we'll upgrade to a more secure backend if it's ever necessary. Use the existing installation UUID. Browser-level site-data deletion can still create another identity, but the game's clear button preserves it and full player-data import/export transfers it.

# New non-circuit components

* Add a dwarf block which is breakable - anything falling onto the dwarf block should destroy it. Anything pushing the dwarf block should push it, unless the push is blocked by something on the other side like a wall, in which case that should also crush the dwarf. Use the shattering animation for this.
* Add a swapper block that swaps its front and rear neighbors when it receives a +1 charge on either side. Keep welds the same - if the front block is a stone block with two sides welded, and rear is a lore rune with no sides welded, after the swap, the front block should be a lore rune (with the original rear neighbor's configuration and rotation/mirroring) but with the welds the stone block had, and vice versa. Except if that would break rules (non-weldable blocks, non-weldable sides of e.g. rotator blocks, and weld-protected blocks). Do not allow swapping with immovable or indestructible blocks. Allow swapping with empty blocks.
* Add a gravity stone that changes its welded body's gravity to point in the gravity stone's forward direction, instead of downward.

# Component behaviors

* Modify the assembler to add a pushing force for output: When it has a pending output, but no space to output, attempt to push the blocks away so that it can produce output; failing that, try to push the assembler itself in its forwards direction, so the product can be emitted out the back (at assembler's pre-movement position) in the same tick.
* Modify the duplicator in the same way as assembler above - make it also attempt to push itself away from the output side, if it's trying to duplicate a single-tile body but there's something blocking the output. When duplicating multi-tile bodies, don't do this - require already empty space for the whole body.
* Potentially allow configuring the initial state of stateful blocks like the rotator (initial head facing) and piston (whether to start expanded or retracted), maybe using some hotkey to toggle. The rotator's initial head direction determines which side can be welded to. For the piston, things like the cost of all placed components is a bit weird; may have to add a special case like piston heads and bodies each having half the price of ordinary retracted body-and-head piston blocks, but still hide body and arm separate blocks from the palette.
* Bug: see `temp/conveyor-blocking-bug.json`. The conveyor is trying to move its own body right, and pushing the body below it left. Both those pushes together would cause an overlap/collision, so they're prevented. However, in this case, we want to still allow the gap to be closed - probably the conveyor block's body should move right and the other body's leftward move should be blocked. Can we have this behavior while still having consistent predictable physics?
* Add more complex furnace adjacency requirements. Copper smelting already requires orthogonally adjacent wood and turns all matching wood into fire on completion; recipe-defined catalysts can also be left unchanged.
	* Add patterns where the catalyst must be on a side not opposite the furnace (so furnace-ore-wood must form a 90-degree bend), on both sides not opposite the furnace, or on all 3 sides of the ore except the furnace. Add these for other ores, since copper ore already has behavior; e.g. metals like steel, galvanized iron, mithril, or others; would need to add blocks for those.

# Audio-related

* Add a mallet or beater block. When it's moved in a direction, it checks the block one further in that direction. If that block is nonempty and belongs to a different body to the beater block, play a sound with pitch dependent on the size of that body. Similar to our current bell block, except the sound depends on the neighboring body.
	* Apply the same expanding-rings animation (implemented for bells) when playing a sound.
	* Make resonators also sense sounds from beaters/mallets.
	* As a large follow-up, define a different character of sound for different materials - metals could sound like our bells currently do, but different sound classes for other types like stone, wood, glass.
	* Once this is present, potentially remove the bell blocks entirely - since we can instead build bells in-world from metal blocks, or build other instruments like lithophones.

# Performance

* Follow the current performance plan `docs/performance-todos.md`: refresh end-to-end browser measurements, investigate active fitted rendering, and measure retained session memory before choosing further optimizations. The original profile and completed optimization log are archived in `performance-history.md`.
* Figure out why our game has high CPU usage currently, and whether we can reduce that (e.g. for battery life on laptop and mobile). The geode bench scene currently uses around 100% CPU while running, on Firefox.

# UI

* Add support for mobile and touch screens. Figure out what changes we need and break this up into more actionable tasks. (For example rotation and configuration currently require keyboard. And in the workshop, the palette panel takes up the entire left half of a vertical screen - move to top of vertical screens, maybe make it collapsible.)
* Implement limited undo/redo in the workshops (when editing puzzle solutions, or editing a sandbox). Probably keep a few previous states in memory. Running/testing should not write to these; it's for undoing modifications. (For sandbox running while editing, it's a bit unclear what the behavior should be. Maybe just advance the ring buffer / list of previous states whenever they edit.) Ideally click-and-drag should count as one action, so can be undone all at once.
* Modify how we store text-boxes in scene and puzzle files. Currently we store them with width, height, x, and y. This is a remnant of when we allowed resizing text-boxes in-game, but we no longer allow that - after editing they're always sized to fit the text. Rather store coordinates of the center only, and recompute sizes when a scene or puzzle is loaded.

# Visuals

## Animations

* Add animation for the delivery box, assembler, and duplicator. When they consume a body, animate the body shrinking, moving towards the block, and lowering opacity until it vanishes. When they produce a body, animate the opposite - body expanding and moving out of the block.

# Content

Ideas and puzzle list moved to `puzzles.md`. We have enough tutorial puzzles. We need to add more actual puzzles, at a range of difficulty levels. Before adding any puzzles, read that file, and keep it updated with new puzzles added.
