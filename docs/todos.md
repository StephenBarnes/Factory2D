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
* Modify the laser splitter so that its beam is stopped when it tries to unweld an edge between weld-protected blocks, rather than continuing. It should not be able to penetrate a wall made of platform blocks and unweld things on the other side of that wall; the laser splitting should only continue until it reaches the weld-protected edge.

# Performance

* Follow the current performance plan `docs/performance-todos.md`: refresh end-to-end browser measurements, investigate active fitted rendering, and measure retained session memory before choosing further optimizations. The original profile and completed optimization log are archived in `performance-history.md`.
* Figure out why our game has high CPU usage currently, and whether we can reduce that (e.g. for battery life on laptop and mobile). The geode bench scene currently uses around 100% CPU while running, on Firefox. Update: we've partially addressed this by not repainting stationary frames, and not animating when paused (by default); but running games with moving parts still use around 100% CPU due to redraws.

# UI

* Add support for mobile and touch screens. Figure out what changes we need and break this up into more actionable tasks. (For example rotation and configuration currently require keyboard. And in the workshop, the palette panel takes up the entire left half of a vertical screen - move to top of vertical screens, maybe make it collapsible.)
* Implement limited undo/redo in the workshops (when editing puzzle solutions, or editing a sandbox). Probably keep a few previous states in memory. Running/testing should not write to these; it's for undoing modifications. (For sandbox running while editing, it's a bit unclear what the behavior should be. Maybe just advance the ring buffer / list of previous states whenever they edit.) Ideally click-and-drag should count as one action, so can be undone all at once.

# Content

Ideas and puzzle list moved to `puzzles.md`. We have enough tutorial puzzles. We need to add more actual puzzles, at a range of difficulty levels. Before adding any puzzles, read that file, and keep it updated with new puzzles added.
