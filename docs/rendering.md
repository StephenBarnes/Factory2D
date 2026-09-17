# Rendering reference

For tile appearance, Canvas geometry, animation, and rendering performance. DOM controls and session ownership are covered in [UI/lifecycle](ui-lifecycle.md); physical behavior belongs in [simulation](simulation.md).

## Shared rendering and style

* `src/render/tile-renderer.ts` draws procedural tiles and welded bodies for the board, palette, placement/selection previews, snippets, and configuration thumbnails. Reuse it instead of building a second visual implementation.
* `src/simulation/tile.ts` supplies tile metadata and colors. `src/styles.css` owns the dwarven stone/bronze/gold/ember/gem palette in CSS custom properties and the serif display stack. Use existing styles and controls rather than creating a separate theme.
* Major panels use stepped gilded corner inlays inspired by `temp/artdeco.txt`. Menu, solution, and dialog action buttons use inset rules and diamond terminals; compact workshop controls stay undecorated. CSS pseudo-elements are pointer-transparent and contained within the borders, with colors inherited from the active theme and no external font or image dependencies.
* `src/render/body-cells.ts` populates render cells from a world and collects bodies for small thumbnails. Render configurable/runtime state through the same shared path so previews match placed components.
* Handedness follows world cells into shared render cells, selections, snippets, and placement previews. Reflect only asymmetric local glyphs and port geometry before rotation; never mirror upright labels or double-reflect already transformed ROM contents. Lookup tables remain logical and upright.

Welded bodies use traced inset rounded-slab outlines, shadows, per-cell fills, clipped decorations, and directional bevel lighting. Neighbor cells merge only across locally welded edges: unwelded cuts must remain visible and stable even when another cut splits a body. Closed seam ends are rounded; diagonal contacts form rounded pinches. Mixed-kind fills remain locally stable when bodies merge or split.

Circuit traces follow actual welded circuit connections and each port's resolved charge; crossing axes and isolated outputs must not collapse into one shared color. Directional markers and short traces must not overlap. Stateful decorations display live buffers, cursors, verdicts, grips, and nested contents. Inspect existing drawing helpers before adding a new component.

Sensor glyphs share an angular eye with a charge-colored diamond or lightning-bolt pupil; their fills are purple. Three-input arithmetic transforms use teal/blue fills. Fixed sources use three charge-colored bolts, inverters use Hagalaz, rectifiers use Thurisaz, and victory stones use Jera. Directional glyphs rotate with their ports; the subtractor's rear plus marks the positive input.

Movement sensors use a purple angular eye with a pale diamond pupil and four independently charge-colored outward arrows. The non-directional glyph is shared by the board, palette, and placement previews. Arrow colors remain visible on unwelded outputs; connected traces stop at their corresponding arrow rather than joining in the center.

Charge-sensor hover and placement overlays circle the first detectable forward cell in the displayed board, skipping empty space and invisible tiles (glass). A line runs from the sensor's front edge to the target circle, or to the grid boundary without a circle when no target is visible. Occupancy sensors retain their immediate-cell marker. Targets beyond an enclosing array's boundary are outside the displayed board and are not circled.

The discernment rune marks its local-left input blue (+1 rear control) and local-right input red (-1 rear control), offset toward the rear to clear circuit traces. These markers rotate with the tile and swap sides when mirrored. The rectifier's Thurisaz thorn points toward its output port.

Body comparers use a purple slab with front/rear outlined blocks and a charge-colored equals sign; the glyph rotates with the sideways circuit ports. Block type comparers share the glyph with a blue-grey slab and pale-blue block outlines.

Laser splitters use a violet slab and an offset forward arrow marking the cutting side: local-left normally, local-right when mirrored. Hover/placement previews draw the complete cutting line to the board boundary; the glyph and preview rotate and reflect together.

Drills use a steel-grey slab with a pale tapered, spiral-cut bit pointing toward the target and a dark rear housing. The shared glyph rotates on the board and in previews; hover/placement highlights the immediate front cell.

Grinders use paired toothed crushing rollers beneath an open intake, with pale axle highlights while active. The shared glyph rotates toward the front target on the board, palette, and previews; hover/placement highlights the immediate front cell.

Floatstone uses a blue slab with a pale suspended diamond above two horizontal levitation lines, shared by the board, palette, and previews.

Levitation projectors use a blue slab with a pale suspended crystal, projecting dish, and forward arrow. A charge-colored inward caret marks the isolated rear circuit input; connected traces stop at the marker. The shared glyph rotates with the beam on the board, palette, and previews. Hover/placement overlays show the potential beam extent: a translucent one-cell-wide strip and bright centerline from the front face to the front face of the first oppositely facing levitation projector, or the local board boundary. Other tiles and projector orientations do not stop the overlay.

Magic links use a violet slab with two golden angular chain links, a forward arrow, and a charge-colored rear input caret. The shared board/palette/preview glyph rotates with the link. Hover/placement overlays draw a thin dashed golden ray to the first oppositely facing magic link or local board boundary, including disabled endpoints as potential targets. This is not a solid bridge; body outlines continue to merge only across physical weld seams.

Sliders use a green-grey slab with two pale rails, a dark central carriage, and opposing arrows along the permitted axis. The shared glyph rotates with the tile on the board, palette, and previews.

Thrusters use a copper-brown slab with a pointed pale housing, flared rear nozzle, and orange exhaust. The shared glyph rotates toward the thrust direction on the board, palette, and previews; ordinary stable-ID interpolation animates movement.

Controlled thrusters share the copper-brown slab, with four outward-pointing pale housings around an orange diamond. The non-directional glyph is shared by board, palette, and previews; each isolated input trace shows its own neighbor's charge without linking the four networks.

Force projectors use a copper-brown slab with a dark rear emitter, a separate forward square target, and blue push/red pull arrows. A charge-colored inward caret marks the rear circuit input even when disconnected; connected traces stop at the marker instead of crossing it into the emitter. The shared glyph and input marker rotate together on the board, palette, and previews. Hover/placement overlays draw a line to the first occupied forward cell and circle it, including glass or the projector's own body; empty rays end at the local board boundary.

Fasteners use a bronze-grey slab with a pale forged fastening pin: a broad slotted hexagonal head, tapered shaft, dark thread cuts, and a gilded edge highlight. The non-directional glyph is shared by the board, palette, and previews. Fasteners hold their welded body against its own gravity until successful conveyor, thruster, piston, or rotator movement breaks them; blocked machinery attempts and gravity-driven downward pushes leave them intact.

Platforms use forest green; ROMs and graphers use jade/teal. Delay, counter, monitor, and array fills use sapphire/indigo, while fixed-charge/spark sources and sequence checkers use gold/amber. Channels and crossings retain neutral slate so wiring stays quieter than active components. These colors come from the shared tile metadata and are identical in both UI themes.

Delay gates use the channel's neutral slate slab with a rear semicircular socket and separate front ball/stem. The socket shows rear-input charge and the ball shows output charge; the glyph rotates with its rear/front ports on the board and in shared previews.

Discard runes use an indigo slab with a directional shutter and upright remaining-tick count. The shutter opens into a charge-colored forward arrow after the discard window; the shared glyph and rear/front port arrows follow orientation on the board and every preview.

Lookup runes share the ROM grid renderer, using a teal slab and jade outline around their fixed 3×3 table without a cursor highlight. Local-left/rear input arrows and front/right output arrows follow orientation and handedness; the logical truth table stays upright on the board and in previews. Assemblers similarly show explicit handed input/output arrows.

Raw-material artwork uses colored rivets for metals and platforms, round grains for dirt and copper ore, grey square grains for iron ore, and curved grain with a knot for wood. Gemstones have cut-diamond outlines with bright/shaded facets and a white specular glint. All use the shared tile renderer, including palette and selection previews.

Raw-material ordering is shared by the palette and authoring cost controls through tile metadata: basic structural materials, sand/glass, iron ore/iron, copper ore/copper, remaining metals, then gemstones.

## Board, camera, and caches

`src/render/canvas-renderer.ts` owns grid rendering, hit testing, pan/zoom, interpolation, previews, hover overlays, and editable-region/array framing.

* The canvas occupies the region left after the palette and bottom controls. Fit the whole grid centered in the actual canvas, including subpixel tile sizes for maximum-size boards. Workshop entry and scene import reset the fit.
* Wheel zoom anchors under the pointer. Pan bounds keep the canvas center over the grid. Account for CSS size, backing-store density, pan, and zoom consistently in hit tests and drawing.
* Body membership and `Path2D` outlines are cached by geometry revision and scale, with localized rebuilding after edits. Visual-only updates reuse paths. Detailed rendering culls offscreen cells; low-detail rendering batches work. Unchanged frames can be skipped, except ongoing animation such as active belts.
* Palette and thumbnail backing stores are density-aware and supersampled. Palette previews redraw when display density/browser zoom changes or the resizable sidebar changes size; component icons scale with sidebar width.
* The UI passes its light-mode setting to each render, including the PNG export render. Theme changes invalidate the frame without rebuilding body geometry; the canvas surround, board fill, grid lines, and root border switch palettes. Tile artwork and signal colors stay unchanged, including in nested views.
* Settings offers a persisted Tile Bevels toggle, enabled by default. `src/render/appearance.ts` shares the preference across board tiles, nested contents, previews, thumbnails, and PNG export. Disabling it skips only the directional highlight/shade strokes; fills, decorations, outlines, and weld gaps are unchanged. Changes invalidate board frames without rebuilding geometry and redraw palette/snippet previews.
* Detail levels use logical cell size, independent of display density and thumbnail supersampling. Below 24 pixels, bevels are omitted even when enabled; below 12 pixels, decorations are omitted too. Rounded body outlines, per-kind fills, and weld gaps remain at both levels, shared by the board and previews. Below 6 pixels, the board retains its batched solid-square fast path.

Do not rebuild body topology or allocate fresh paths every animation frame. Preserve the separation of geometry and visual revisions when adding visual state or invalidation.

## Animation and overlays

Interpolation uses stable tile IDs between adjacent previous/current committed worlds and never changes physics. `render/translation-interpolation.ts` caches previous-ID positions and per-cell motion by snapshot/revision, supporting board-spanning displacement rather than a one-cell neighborhood search. A fresh piston base derives its previous anchor from the adjacent arm's old retracted-piston ID. Cached motion subgroups split deforming welded assemblies so bases, carried charge blocks, heads, and loads follow their own displacements; shaft growth remains relative to the moving base. Detailed drawing layers subgroup fills before artwork, and both detailed/low-detail culling include cells whose interpolated position is visible even when their destination is offscreen. Automatic steps can batch between frames; rates at or above 60 ticks/second force discrete rendering without changing the player's animation preference.

Accepted rotator turns retain transient per-ID pivot, direction, and pre-turn positions in `simulation/rotation-animation.ts`, bound to the exact previous snapshot and final committed revisions. `render/rotation-interpolation.ts` reuses identity lookups and transforms cached committed body paths around those pivots, including swept/enclosed loose bodies. Same-tick gravity before the turn and piston movement after it contribute interpolated translation corrections, preserving both endpoints. Detailed artwork, low-detail tiles, and signal highlights share the transform; culling uses transformed bounds. Edits, reset, mismatched snapshots, and nonanimated steps cannot replay stale turns. Matching nested snapshots are captured before their containing arrays translate.

Rotator grip arrows interpolate between committed directions using stable IDs and the same progress as movement. Previous grip directions are cached per previous-world revision; render-only quarter-turn offsets leave component state and rear input markers unchanged. Carried rotators subtract their body's turn from the grip offset to avoid rotating it twice. Missing previous IDs and completed/discrete frames show the committed grip directly. Batched opposite-side grips interpolate through the front rather than the rear input.

Rotators show blue + and red - curved direction indicators, reversing with handedness; hover sweep hints use the same signed mapping. The live grip direction is absolute world state and must not be reflected again when drawing or interpolating it.

Conveyors reverse their animated belt travel with handedness. Mirrored belts add fixed counterclockwise chevrons identifying their +1 direction even when stopped; normal belts retain their unmarked center dot. The shared glyph covers the board, palette, placement ghosts, and selection/snippet previews.

Furnaces, drills, and grinders draw a rear progress bar from committed processing ticks and the current target's recipe duration. Active bars are gold; paused progress is muted and retained. The completion tick shows a full bar, then clears on the next idle tick. Target identity checks prevent transferred progress from appearing on a replacement target. The shared body-cell path carries this display into selections and thumbnails without adding simulation state.

Processing glyphs use the machine's isolated rear output, independent of orientation: active furnaces flicker, drill grooves travel along the bit, and grinder teeth counter-rotate. Like conveyor animation, these use the render clock, including while the simulation is paused on an active tick. Visible active machines keep frames invalidated without rebuilding body geometry. Glyphs and bars follow the existing decoration-detail cutoff and rotate with the machine.

Placed-component overlays use the hovered world's actual kind/orientation/handedness, including fixed or simulation-locked tiles; placement overlays use the ghost's frame. The shared dispatcher handles welder/splitter target edges, occupancy-sensor observation cells, and rotator grip/sweep hints. Clear overlays with hover and clip to board bounds. Selection previews retain transformed handedness, welds, and configurable appearance; invalid destinations show invalid feedback rather than modifying fixed cells.
* Rejected-edit overlays live in `CanvasRenderer`, independent of world revisions and simulation animation settings. Region borders and rejected weld cells hold briefly and fade over 700 ms of wall-clock time, keeping paused frames invalidated through the final clearing redraw. Renderer remounts discard this feedback rather than carrying it into another board or nested view.
* Successful player weld/unweld edits (including placement auto-welds) and welder/splitter/laser-splitter commits emit two white sparks along the shared edge: left/right for top/bottom neighbors, up/down for left/right neighbors. Welding sends sparks outward; unwelding starts 0.19 cells beyond each endpoint and converges at the edge center, with trails behind the inward motion. `simulation/weld-animation.ts` records transient per-edge wall-clock timestamps and weld/split state only for watched worlds; `render/weld-sparks.ts` draws a 350 ms travel/fade at the operation site, clipped to the board. Effects animate while paused and with movement interpolation disabled, including the final clearing redraw. Repeated operations refresh one edge flash with the latest operation's direction; rejected/no-op operations and welds copied during movement do not flash. Renderer remounts start fresh, including entering nested boards; cloning and serialization never carry effects.
* Furnace/grinder transformations emit eight product-colored chips at the committed processing site. `simulation/processing-animation.ts` follows the weld-effect watch lifecycle: transient, cell-keyed completion records for mounted worlds only, bounded to one burst per cell. `render/processing-particles.ts` draws a 450 ms outward burst with downward drift and fading, using tile fill/decoration colors and clipping to the board. These effects also animate while paused or without movement interpolation, clear on expiry, and never travel through cloning or serialization. Progress-only ticks, placement, and drilling do not emit processing chips; remounting a root/nested view discards old effects.
* Fragile landings, drill destruction, and fasteners broken by conveyors/pistons/rotators share `simulation/shatter-animation.ts` events at their committed destruction cells. `render/shatter-particles.ts` splits an undecorated tile-colored rounded slab along a line 30 degrees from vertical; the halves separate and fade over 200 ms, including while paused after a single step. Paths are cached, effects are clipped to the board, and expiry triggers a final clearing redraw. Records are bounded to one per cell in watched root/nested views and never enter cloning or serialization; remounting discards them. Disabling animations or zooming below six pixels per cell clears effects without replay. Editing/erasing and machine consumption do not shatter tiles.

`src/ui/tool-cursor.ts` uses the shared tile renderer and complete palette tool swatches for a small pointer-adjacent icon. It tracks temporary Control welding and hides outside the board, for touch, on blur/cancellation, in modals, and outside workshops.

Entered rune arrays draw their four outer charges as virtual conduits beyond the inner board, with edge-center port markers. The displayed world may be nested while the simulation remains rooted. Signal-panel hover highlights the source on its own board or the containing rune array visible on an ancestor board; sources outside the displayed subtree have no highlight.

PNG export crops the current rendered pixels to the visible grid, excluding the surround and virtual array ports. Respect pan, zoom, and fractional device-pixel ratios without resampling. It exports neither offscreen board areas nor a separately rerendered whole board.

## Verification

Use the running browser to inspect changed visuals on the board and any affected palette/ghost/thumbnail surfaces. Check orientations, weld seams, charge/state variants, small zoom, and display density when relevant. `tests/tile-renderer.test.ts`, `tests/body-cells.test.ts`, and `tests/canvas-renderer.test.ts` cover outline stability, render-cell population, fitting, cache invalidation, culling, and redraw behavior. Browser interaction regressions live in `e2e/`.
