Components:

* Welder blocks.
* Splitter blocks.
* Comparer-sensors.
* Electrical components like logic gates, delays, latches, diodes, brush connectors (or voltage sensors, rather).
* Assemblers that convert a group of blocks welded in a specific way into one block. For example iron and copper blocks welded in a specific way are converted to a piston block.
* Flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide/overlap other blocks.
* Laser splitter: splits everything in a line.
* Configurable components where the player can enter a number in a text box, e.g. a configurable-delay repeater.
* Component that rotates a neighboring block or body around itself.
* Circuit-board components with internal grids where mini-components can be placed to program their behavior.

Performance:

* Profile to determine if there's any need to optimize, and if so, what to optimize.
* Check if we're caching connected/welded bodies, or flood-filling every frame. Can easily cache it and update only on the infrequent weld/unweld operations.
* Mark some tiles or regions as asleep, if they have no updates. Wake up only regions where things are happening. E.g. a static structure made of only solid no-action blocks doesn't need to be processed every frame, doesn't need to re-check gravity every frame, etc.
* Cache circuit networks instead of rebuilding every tick.
* Maybe: Compute the next simulation step async, while the last update is still being animated. Would improve performance if simulation step time grows to exceed frame time.

Circuit network:

* Figure out how to handle wires that become split or welded together.
* Extend the set of charges (0, +1, -1) to add orthogonal +i and -i charges, or add a 2-wire tile with components for reading the different wires.
* There are some fun gates unique to signed signals. ABS gate (-1 -> 1), rectifier (negative to zero), min, max, select (control -1 or +1).