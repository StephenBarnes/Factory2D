Current shipped catalog: **26 puzzles — 7 tutorials and 19 non-tutorials**. Each entry below links to its definition in `src/game/puzzles/`; names, groups, and ordering follow those files.

# General guidelines for non-tutorial puzzles

* Avoid text-boxes on the puzzle. Mostly they're used for tutorials, or easy puzzles where mechanics are encountered for the first time.
* Disable platform blocks in the palette - those are mostly for puzzle design, not solutions.
* If there's potentially complex circuitry involved, enable signal monitor and ROM grapher.
* Avoid enabling very powerful blocks, namely: thruster, controlled thruster, duplicator, force projector.
* Ensure solution-testing machinery is protected. Don't leave indestructible conduit blocks, victory block, or delivery box exposed on any sides (except the delivery block's receiving front face) because otherwise a single fixed charge block solves the puzzle. We should prevent low-effort exploits; high-effort exploits are fine.
* Surround most of the puzzle with a border of welded stone blocks. Use platform blocks only for the part that needs protection.

# Tutorial puzzles

**Avoid adding more tutorial puzzles.** Players don't need a separate tutorial for each component, they can figure it out from the inspector's tooltips and experimentation. Assume they've played Zachtronics games.

Current tutorial puzzles:
* [Click to test](../src/game/puzzles/click-to-test.json): no player-modifiable region; they just click the button to test it. Demonstrates basic puzzle testing flow.
* [Stone drop](../src/game/puzzles/stone-drop.json): teaches placing blocks, player-modifiable region, palette, gravity. Place one stone block and let it fall into the delivery box. The right half shows exactly what's needed.
* [Sand fall](../src/game/puzzles/sand-fall.json): build a ramp for sand to fall diagonally down. Teaches diagonal gravity and welding. Right side of the grid has an example showing how welded parts work and how sand falls.
* [Basic runelore](../src/game/puzzles/basic-runelore.json): three annotated steps introduce channels, remote charge sensing, and inversion. Carry a +1 signal, bridge a gap with a charge sensor, and invert a -1 signal back to +1 before it reaches the judgment stone.
* [Vehicle](../src/game/puzzles/vehicle.json): build a self-propelled vehicle in the upper-right bay and drive left across the stone floor to activate the fixed sensor. Introduces powered conveyors and their reaction forces, with example machinery below the floor.
* [Basic manufacturing](../src/game/puzzles/basic-manufacturing.json): trigger a fixed duplicator through a charge sensor, move iron blocks with conveyors, weld pairs into horizontal 2x1 pieces, and deliver ten pieces. Annotated instructions cover duplication, transport, and automatic welding.
* [Gordian knot](../src/game/puzzles/gordian-knot.json): the stated sapphire-delivery task is impossible; the solution requires bypassing it by welding a fixed +1 charge to the judgment stone. Teaches that a puzzle's win condition is defined on the game board rather than via metadata, that exploits are possible, and exposes a much larger component palette.

Some of these puzzles deliberately allow some amount of optimization, e.g. Basic runelore can be solved more cheaply by placing a charge sensor, Vehicle by mirroring a conveyor block, and Basic manufacturing by placing a duplicator.

Things not explicitly covered by the current tutorials:
* Gates delay signals by one tick; branches must be time-equalized with delay gates. Necessary for solving the rectifier puzzle, binary crossed channels, and other puzzles we add later.
* Pistons and rotators.
* Magnets.
* Transformation machines beyond duplicators: furnaces, grinders, and assemblers.
* Splitters, laser splitters, dismantlers. (Basic manufacturing already covers welders.)
* Charge sensors' interaction with glass.
* Bell blocks, and resonators (once those are added).

# Current non-tutorial puzzles

The puzzle set we ship on first release should focus more on mechanical puzzles.

## Transportation

Transportation puzzles involve building a vehicle that travels along some route, and maybe carries something or does very simple operations along the way (like unwelding one block).

* [Hill climber](../src/game/puzzles/climber.json) (Intermediate): build a vehicle that climbs one-cell steps to reach the sensor on the right. Harder than Vehicle; the reference solution uses a back conveyor plus an elevated front conveyor pushed down by a piston when a sensor detects a step. Other approaches include periodically moving the front conveyor or using multiple vehicles as successive platforms.
* [Hammer delivery](../src/game/puzzles/hammer-delivery.json) (Intermediate): transport five replacement hammers from a fixed duplicator to the delivery box. The supplied hammers point sideways and must be rotated head-down for delivery; the player's build region is a small bay between the supply and receiver.
* [Chasm climber](../src/game/puzzles/chasm-climber.json) (Intermediate): build at the bottom of a tall, narrow shaft with staggered ledges and climb to any of the downward-facing sensors at the top. Unlike Hill climber, the goal is sustained vertical travel.
* [Gold delivery](../src/game/puzzles/gold-delivery.json) (Intermediate): deliver the single supplied gold block across a wall. Drills and welders/unwelders are not in the palette, so the wall can't be destroyed; solution would require something like placing a conveyor which is lifted by two pistons to transport the gold over the wall.
* [A dangerous crossing](../src/game/puzzles/a-dangerous-crossing.json) (Intermediate): build on the left bank and cross a wide chasm to touch the sensor on the right. Duplicators and welders are available, allowing players to explore bridge-building as well as other transport designs.
* [Crystal stalactite](../src/game/puzzles/crystal-stalactite.json) (Hard): retrieve the ruby attached to a ceiling stalactite and deliver it at the cave floor. The build region is near the bottom, so machinery must reach the suspended gem, detach it, and bring it back.

## Manufacturing

Manufacturing puzzles involve turning a few small components into small or large products.

* [Glass blocks](glass-blocks.json) (Easy): sand falls from above. It must be smelted into glass blocks and delivered. Introduces furnaces and fragile blocks. Solution is easy, but leaves some room for optimizing cycles or price by several means (moving/modifying the sand dispenser, dropping glass directly on delivery to avoid shattering, grinding the stone ceiling/walls for more sand, or using advanced blocks in palette).
* [Reclaimed machinery](../src/game/puzzles/reclaimed-machinery.json) (Easy): catch a falling duplicator, its attached charge sensor, and a single ruby, then deliver six separate rubies. Neither duplicators nor rubies are available in the palette. The reference solution catches the template and machine at the same height, powers the surviving sensor remotely, and carries the copies to the receiver on conveyors.
* [Copperworks](../src/game/puzzles/copperworks.json) (Intermediate): smelt a finite supply of six copper ore blocks beside wood, then deliver all six copper blocks. The compact lower workshop requires coordinating six-tick processing with transport and fresh fuel: all wood touching the ore becomes fire on completion and can ignite neighboring wood on the next tick. There is no replacement ore and duplicators are unavailable.
* [Tinworks](../src/game/puzzles/tinworks.json) (Intermediate): smelt six scattered tin ore blocks and deliver six separate tin blocks. Wood must touch a lateral side of the ore, forming a right angle with the furnace, and burns on completion. The finite supply and wide input spacing offer a choice between parallel hearths and a shared processing line. Platforms, duplicators, thrusters, and force projectors are unavailable. The reference solution uses slider-supported hearths with wooden floors that burn away to release the tin onto a conveyor; it completes in 28 cycles.
* [Iron plates](../src/game/puzzles/iron-plates.json) (Hard): duplicate iron ore, smelt it, and weld three iron blocks in a row; deliver ten plates. Two duplicators offer tradeoffs between cycles, footprint, cost, and complexity. Exploits may also be possible, such as drilling away a duplicator and duplicating entire plates.

## Extraction

Extraction puzzles involve turning a large input into small outputs by removing most of the blocks or separating one type from another.

* [Arrowhead reclamation](../src/game/puzzles/arrowhead-reclamation.json) (Intermediate): reclaim 35 individual iron blocks from 8 elven arrows, each with a 5-block iron head and wooden shaft. Palette components support different separation and disposal strategies.
* [Geode extractor](../src/game/puzzles/geode-extractor.json) (Intermediate): extract ten ruby blocks from duplicated stone-shell geodes and deliver them. Two duplicators face different directions, so players can use either supply or both for higher throughput. Drills, splitters, welders, rotators, magnets, grinders, and circuitry support different extraction layouts; the reference solution uses drills and conveyors. More intermediate extraction puzzles could introduce drills before this one.

## Runelore

* [Comparer](../src/game/puzzles/comparer.json) (Intermediate): detect increases, decreases, and unchanged values using only channels, inverters, and combiners. Three cases cover all nine ternary transitions, negative startup, and long steady readings.
* [Holding pattern](../src/game/puzzles/holding-pattern.json) (Intermediate): stretch each one-tick +1 or -1 pulse into exactly ten ticks of the same sign, then return to zero. Four cases cover both starting signs, back-to-back pulses (including repeated signs), and uneven gaps. The palette includes basic gates, delay gates/runes, counters, crossings, and rune arrays. The reference solution uses combiner feedback and a delayed inverted input to end each hold.
* [Rectifier](../src/game/puzzles/rectifier.json) (Intermediate): build a rectifier without the rectifier block, using only channels, inverters, combiners, and multipliers. Output +1 for +1 inputs and zero otherwise; both test cases begin with +1.
* [Binary crossed channels](../src/game/puzzles/crossed-channels.json) (Hard): cross two streams containing only 0 and +1 without the dedicated crossing block. Six cases check the crossed outputs. Can be done with three equality gates, with delays to align paths and suppress the initial spurious `0 = 0` equality.
* [Ternary crossed channels](../src/game/puzzles/ternary-crossed-channels.json) (Expert): cross two full ternary streams without the dedicated crossing block. Six cases include negative startup, steady values, synchronization, and opposite polarities. The reference solution uses nested rune arrays.

The fixed ROM signal sources in these five runelore puzzles face right and are mirrored, so rear +1 reads the authored spatial grid left-to-right, then top-to-bottom under component-relative carry rules. Reference scenes use the same handedness.

## Reworking

Reworking puzzles involve turning large inputs into large outputs. Basically the overlap of manufacturing and extraction, and generally harder than both.

* [Pickaxes to hammers](../src/game/puzzles/pickaxes-to-hammers.json) (Hard): produce five warhammers by reforging supplied pickaxes or smelting supplied ore. Separate duplicators provide the two feedstocks; drills, splitters, welders, and furnaces support different production routes. Delivered hammers must match the template with their heads facing left.

## Mining, Advanced Runelore, Rescue, and Elves (4 groups)

All currently empty.

Mining puzzles will involve transport/vehicles plus extraction, e.g. drilling through a stone cavern to extract gemstones scattered throughout it.

# Ideas for non-tutorial puzzles

* Count up to N pulses from two separate sources and decide which source gave more pulses in total. One solution idea: use a counter block, with an inverter on one of the two inputs, and then check whether final value is positive or negative? But wrap-arounds are possible, so maybe use spark blocks to initialize it to N. Also we can't read the value of the counter block directly, would need to decrement it until it reaches zero and compare number of decrements to initial value; but that seems like almost the same problem we started with?
* A set of basic circuit problems, where you only have: conduit, combiner, inverter, and fixed source. Add puzzles to build most of the more advanced circuit components out of these. The combiner is effectively a sum or vote/majority rune. Combiner also gives a 1-tick delay, so you can chain them to make a machine that acts like a delay rune with arbitrary memory size. Combiner with duplicate inputs, one delayed and inverted, gives edge detection. Spark is fixed value plus edge detection. For the rectifier/diode, we have a puzzle and reference solution, which needs two combiners and a multiplier. Rectifier could also be built using two combiners, fixed source, and inverter: use fixed source and inverter to get -1, then compute `Combiner(x, x, -1)` which takes (-1, 0, 1) to (-1, -1, 1), and then combine that with +1.
* Physically reverse a list: The player's machine receives ruby blocks and sapphire blocks in some order; they must be output in reverse order. Requires building a physical contraption that behaves like a push/pop stack, or maybe putting them in a box and physically rotating it. The player presses a button to receive the next block, and we drop a stone block (or pulse a signal) to indicate the end of the sequence. (How do we build the infra to test? Maybe a delivery box, swapping which block is below it. Or maybe use block-comparer to produce +1 and -1 charge for each one received, and then compare sequences omitting zeros. Or maybe put the entire sequence we expect on a conveyor belt below the delivery box.)
* Physical subtraction: Receive some number of stone blocks and some number of iron blocks; output a number of blocks equal to the absolute value of the difference, then press a button to validate answer.
* Puzzle: Given a supply of sand blocks, and a conduit that pulses N times, move N sand blocks to the output, and the rest to a different output. Alternatively, provide the requested amount via a clock that pulses every N ticks; or via a few separate buttons for requesting different amounts (say 1, 2, 3, 5; or ternary -3, -1, +1, +3, +5, and if multiple are on, they must output the sum).
* Puzzle: ROM implemented in-world with basic components. Given an NxM rectangle of ruby and sapphire blocks, and circuit impulses on a given column or row, read the ruby/sapphire state at that specific 2-dimensional index. Repeat for several lookups in the same NxM rectangle. Different test cases modify the blocks in the rectangle.
* Puzzle: given N circuit inputs, output the most common one among them. As a variant, give them one signal with +1 and -1 over different ticks, and they must output the modal value / sign of the sum.
* Look at other puzzle games (The Witness, various Zachtronics games, Roody:2d) for inspiration. Add any components necessary to allow implementing similar puzzles in our game. For example, we could make Witness-style mazes by letting the player place only conduits, and they have to link a fixed charge to the victory block; but how could we implement other constraints from Witness's puzzles?
* Various straightforward mechanical manipulation puzzles, e.g. given stone blocks, weld them into 1x2 bodies, or 2x2, or one of each tetromino, or shapes made of different block types in specific configurations.
	* As additional puzzles, could add various constraints, e.g. use lock gate pattern to enforce creating some intermediate, then unwelding that and reassembling into a different shape.
	* Or give them a large top region to assemble one tetromino (chosen by a circuit input, different one each test case), but then it has to pass through a 2-wide gap to reach the delivery box. Or through a 1-wide gap to a small region that can do only a small amount of additional welding.
* Given rotator blocks and various circuit blocks, carry stone blocks from a low starting position to a high delivery block, by rotating them repeatedly.
* Puzzle: build a lock gate that allows through only bodies matching a specific shape.
* Puzzle: build a gantry that grabs bodies and moves them over a wall.
* Crossing a gap by building a flying machine. (Uncertain if this is even possible, unless we allow components that trivialize it, like horizontal sliders.) We currently have a Chasm Crosser puzzle, but we allow the duplicator block, and solution requires duplicating and welding blocks to build a bridge; doing it without a duplicator would be harder.
* Kaizen-style puzzles: Given dispensers providing any number of welded 2x2 and 3x4 iron bodies, assemble iron helmets, which are some complex shape made of iron blocks. The player must decide how to drill and weld/unweld blocks to make up the helmet shape, and implement that in machinery.
* Slider block puzzles, like Rush Hour: Given some complex arrangement of welded pieces, each with a slider block preventing horizontal or vertical movement, build a device that will untangle them and extract one gem in the center.
* Puzzle: You have 1 gemstone. Must show the gemstone at port 1, then port 2, then port 3, etc., corresponding to requests on the back wall. Requires moving it around according to commands.
* Route sand falling from above to different outputs on the right side. Some potential for tiny machinery plus long chutes, relying on sand falling rather than transporting all the way.
* Puzzle where you have to push a hanging piece up a ladder; it slots into the rungs. Maybe your entire contraption also needs to go back into a hole periodically to avoid walls that sweep across.
* Puzzle where a gemstone or trapped dwarf is entangled in differently-shaped stone pieces; must build pistons to shift the pieces in a specific way so the gemstone can drop down into a delivery box.
* Puzzle where you receive one stone block and must move it to one of N different output chutes depending on which one has a +1 signal nearby. Each test case only expects one single stone block delivered. As a follow-up, add a variant where the board has a complex shape, e.g. an S-shaped empty region surrounded by stone, with various delivery spots along the S.
* Add some puzzles in the style of very hard minimal puzzle games like Magicube, Jelly No Puzzle, Snakebird, Baba Is You - specifically minimal puzzles that seem impossible at first glance. Minimal meaning the puzzle is small, the player-modifiable region is small, and the set of allowed components is small.
* Give an input signal with say 8 values. Require outputting all 8 values to 8 different output ports, at the same time. Requires some basic delays, or potentially a falling charge sensor that feeds into different latches made from delay gates, or similar.
* Cave-in rescue: a dwarf is trapped underneath several bodies made of stone blocks in different shapes. Build a machine to remove all of them without crushing the dwarf, and then move the dwarf to a delivery box.
* Given ore blocks falling from different positions on the ceiling, collect all of them and drop them into one delivery box. Obvious solution is conveyor belts, so disable those.
* Puzzle where you have to output a specific sequence of ternary values, in order. We ban the ROM rune and lookup rune, so it has to be implemented with delay gates, sparks, fixed charges, etc. Kind of like painting a picture with red/blue/black pixels. We could have an entire "art" puzzle group with different variants, like a checkerboard or 3-color checkerboard or square of blue surrounded by black, etc.
* A dangerous crossing already allows duplicators and welders for bridge-building. A harder follow-up could provide ore dispensers instead of freely placeable construction materials, requiring smelting and assemblers to manufacture conveyor belts and platforms while advancing.
* Carry a 1-trit signal from a top chamber to a bottom chamber, through a 1-wide chute. The top and bottom chambers are player-modifiable but the chute is not. So they probably need to choose one block to drop based on the trit, then interpret that signal at the bottom.
* Basic manufacturing already covers welding pairs into 1x2 bodies, using iron rather than stone. Further small manufacturing puzzles could require different shapes or mixed materials.
* Puzzle where there's 3 circuit inputs; in each test case, one is +1 while the rest are zero. The player must manufacture one specific item dependent on the signal, and get it to a delivery box (which accepts a different item in each test case, matching the circuit input). The 3 possible products are similar, made from mostly the same blocks but with slightly different configurations - maybe pickaxes, hammers, and swords. So the key to keeping footprint small is reusing as much of the production system as possible between the 3 possibilities.
	* Add variants: different sets of products, different degree of overlap, different number of options.
	* Variant with 2-dimensional signals, e.g. "make a {gold, silver, copper} ring with a {ruby, diamond, sapphire, nothing} on top".
* Multidirectional vehicle. Player's vehicle starts in the center; must travel in a direction given by circuit signal (one signal for each test case). Travel left/right on ground, up (by reaching up to a hanging ladder), or down (via digging or fitting through a small hole). To ensure they don't just build 4 separate small vehicles, we let them start with one diamond gemstone in the center, and this must be delivered to the endpoint.
* Race track: there's a central floating body with beam block type sensors checking for diamonds in 4 cardinal directions. Around that there's a ring of empty space, then around that a solid border. The player must build a vehicle around a single diamond block. Then the vehicle must activate all 4 sensors, by travelling around the entire ring. Requires building a multi-purpose vehicle that can travel right, upward (similar to Chasm Climber puzzle), left, and then fall down past the last sensor.
	* Could have arbitrary race-track shapes with beam block sensors checking they visit all checkpoints.
	* Could have a relay race variant - partway through the track there's a 1-wide window through which they have to pass the diamond to a separate vehicle which does the rest of the race.
* Converting unary to decimal. The player gets N stone blocks for N at most 99. They must output N mod 10 into one output chute, and N integer-divide 10 into another.
* Reading decimal digits. We give the player a stone polyomino representing a digit 0-9, and they must output that many stone blocks into a chute.
	* Also the reverse - construct decimal digit to represent a number.
* Carving up arbitrary input shapes into individual blocks. The player is given a polyomino fitting inside a 5x5 box. They must chop it up into individual blocks and deliver those. Each test case has a different input shape.
* Polyomino packing: set up sensors to detect various polyominoes inside the player-modifiable region. Victory iff all of them are detected. Entirely ignores 90% of our game mechanics (anything that happens over multiple ticks is irrelevant), but might still be fun.
	* Then a follow-up puzzle that gives them too little space to actually fit all the shapes; so they have to build a machine that creates all necessary shapes in sequence, by welding and unwelding, etc. over multiple ticks.
* Harder variants of "Reclaimed machinery", e.g. needing to pick up the components lying on the ground.
* Puzzle where circuitry is banned on the right third of the grid (using beam block sensors to check for conduits, fixed charges, sparks) but allowed on the left third. Left third receives a signal; right third must act based on that signal in some way. Options include mechanically transmitting the signal, avoiding only the specific block types that the beam sensors check for, or bells and resonators.
* Puzzle with an unbreakable wall between two halves. A signal is given on the left half, and must be transmitted to the right half. Bells are mandatory for communicating across the wall. Make the input signal wide, say 20 separate trits communicated on 20 channels, fixed value per channel in each test case. So optimizing for cycles requires developing some kind of encoding that compresses this input into a handful of bell rings, then reading that signal on the right half.
* Puzzle that requires handling a box of wood that's currently on fire. Duplicator makes boxes of wood but somehow sets them on fire, which then spreads. So a low-cycles solution requires extracting as much of the wood as possible from each duplicated body.
* Puzzle that requires transporting something very quickly over a large distance - probably by welding it to a long arm on a flipper, then flipping to cover the distance in one tick, then unwelding to deposit.
* Receive a mixture of gemstones from one dispenser. Deliver all of the rubies first, then all the emeralds, then all the sapphires.
* Separate puzzles with simple smelting tasks: making bronze and steel. Tinworks now covers tin's lateral-fuel rule. These are made complex by our furnace recipe rules. Include demonstrations of the relevant smelting rule (cases that work or don't work) on one side of the board, not player-modifiable and behind an indestructible wall.
* Add a separate section for advanced manufacturing, which requires producing large structures from basic parts, e.g. making a complex steel-and-bronze structure given only ore block dispensers.
