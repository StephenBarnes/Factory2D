# Rendering reference

For tile appearance, Canvas geometry, animation, and rendering performance. DOM controls and session ownership are covered in [UI/lifecycle](ui-lifecycle.md); physical behavior belongs in [simulation](simulation.md).

## Shared rendering and style

* `src/render/tile-renderer.ts` draws procedural tiles and welded bodies for the board, palette, placement/selection previews, snippets, and configuration thumbnails. Reuse it instead of building a second visual implementation.
* `src/simulation/tile.ts` supplies tile metadata and colors. `src/styles.css` owns the dwarven stone/bronze/gold/ember/gem palette in CSS custom properties and the serif display stack. Use existing styles and controls rather than creating a separate theme.
* Major panels use stepped gilded corner inlays inspired by `temp/artdeco.txt`. Menu, solution, and dialog action buttons use inset rules and diamond terminals; compact workshop controls stay undecorated. CSS pseudo-elements are pointer-transparent and contained within the borders, with colors inherited from the active theme and no external font or image dependencies.
* `src/render/body-cells.ts` populates render cells from a world and collects bodies for small thumbnails. Render configurable/runtime state through the same shared path so previews match placed components.

Welded bodies use traced inset rounded-slab outlines, shadows, per-cell fills, clipped decorations, and directional bevel lighting. Neighbor cells merge only across locally welded edges: unwelded cuts must remain visible and stable even when another cut splits a body. Closed seam ends are rounded; diagonal contacts form rounded pinches. Mixed-kind fills remain locally stable when bodies merge or split.

Circuit traces follow actual welded circuit connections and each port's resolved charge; crossing axes and isolated outputs must not collapse into one shared color. Directional markers and short traces must not overlap. Stateful decorations display live buffers, cursors, verdicts, grips, and nested contents. Inspect existing drawing helpers before adding a new component.

Sensor glyphs share an angular eye with a charge-colored diamond or lightning-bolt pupil; their fills are purple. Three-input arithmetic transforms use teal/blue fills. Fixed sources use three charge-colored bolts, inverters use Hagalaz, rectifiers use Thurisaz, and victory stones use Jera. Directional glyphs rotate with their ports; the subtractor's rear plus marks the positive input.

The discernment rune marks its left input blue (+1 rear control) and right input red (-1 rear control), offset toward the rear to clear circuit traces. These markers rotate with the tile. The rectifier's Thurisaz thorn points toward its output port.

Body comparers use a purple slab with front/rear outlined blocks and a charge-colored equals sign; the glyph rotates with the sideways circuit ports.

Laser splitters use a violet slab and an offset forward arrow marking the local-left cutting side. Hover/placement previews draw the complete cutting line to the board boundary; the glyph and preview rotate together.

Drills use a steel-grey slab with a pale tapered, spiral-cut bit pointing toward the target and a dark rear housing. The shared glyph rotates on the board and in previews; hover/placement highlights the immediate front cell.

Grinders use paired toothed crushing rollers beneath an open intake, with pale axle highlights while active. The shared glyph rotates toward the front target on the board, palette, and previews; hover/placement highlights the immediate front cell.

Floatstone uses a blue slab with a pale suspended diamond above two horizontal levitation lines, shared by the board, palette, and previews.

Fasteners use a bronze-grey slab with a pale forged fastening pin: a broad slotted hexagonal head, tapered shaft, dark thread cuts, and a gilded edge highlight. The non-directional glyph is shared by the board, palette, and previews. Fasteners hold their welded body against its own gravity until successful conveyor, piston, or rotator movement breaks them; blocked machinery attempts and gravity-driven downward pushes leave them intact.

Platforms use forest green; ROMs and graphers use jade/teal. Delay, counter, monitor, and array fills use sapphire/indigo, while fixed-charge/spark sources and sequence checkers use gold/amber. Channels and crossings retain neutral slate so wiring stays quieter than active components. These colors come from the shared tile metadata and are identical in both UI themes.

Discard runes use an indigo slab with a directional shutter and upright remaining-tick count. The shutter opens into a charge-colored forward arrow after the discard window; the shared glyph and rear/front port arrows follow orientation on the board and every preview.

Lookup runes share the ROM grid renderer, using a teal slab and jade outline around their fixed 3×3 table without a cursor highlight. Local-left/rear input arrows and front/right output arrows rotate with the tile; the logical truth table stays upright on the board and in previews.

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

Interpolation uses stable tile IDs between adjacent previous/current committed worlds and never changes physics. Piston arm IDs follow the head and support extension/retraction decoration animation; the extending shaft's rear endpoint stays at the base anchor until its full length fits ahead of the base. Automatic steps can batch between frames; rates at or above 60 ticks/second force discrete rendering without changing the player's animation preference.

Accepted rotator turns retain transient per-ID pivot, direction, and pre-turn positions in `simulation/rotation-animation.ts`, bound to the exact previous snapshot and final committed revisions. `render/rotation-interpolation.ts` reuses identity lookups and transforms cached committed body paths around those pivots, including swept/enclosed loose bodies. Same-tick gravity before the turn and piston movement after it contribute interpolated translation corrections, preserving both endpoints. Detailed artwork, low-detail tiles, and signal highlights share the transform; culling uses transformed bounds. Edits, reset, mismatched snapshots, and nonanimated steps cannot replay stale turns. Matching nested snapshots are captured before their containing arrays translate.

Rotator grip arrows interpolate between committed directions using stable IDs and the same progress as movement. Previous grip directions are cached per previous-world revision; render-only quarter-turn offsets leave component state and rear input markers unchanged. Carried rotators subtract their body's turn from the grip offset to avoid rotating it twice. Missing previous IDs and completed/discrete frames show the committed grip directly. Batched opposite-side grips interpolate through the front rather than the rear input.

Placed-component overlays use the hovered world's actual kind/orientation, including fixed or simulation-locked tiles; placement overlays use ghost orientation. The shared dispatcher handles welder/splitter target edges, occupancy-sensor observation cells, and rotator grip/sweep hints. Clear overlays with hover and clip to board bounds. Selection previews retain transformed welds and configurable appearance; invalid destinations show invalid feedback rather than modifying fixed cells.
* Rejected-edit overlays live in `CanvasRenderer`, independent of world revisions and simulation animation settings. Region borders and rejected weld cells hold briefly and fade over 700 ms of wall-clock time, keeping paused frames invalidated through the final clearing redraw. Renderer remounts discard this feedback rather than carrying it into another board or nested view.
* Successful player weld/unweld edits (including placement auto-welds) and welder/splitter/laser-splitter commits emit two white sparks along the shared edge: left/right for top/bottom neighbors, up/down for left/right neighbors. `simulation/weld-animation.ts` records transient per-edge wall-clock timestamps only for watched worlds; `render/weld-sparks.ts` draws a 350 ms travel/fade at the operation site, clipped to the board. Effects animate while paused and with movement interpolation disabled, including the final clearing redraw. Repeated operations refresh one edge flash; rejected/no-op operations and welds copied during movement do not flash. Renderer remounts start fresh, including entering nested boards; cloning and serialization never carry effects.

`src/ui/tool-cursor.ts` uses the shared tile renderer and complete palette tool swatches for a small pointer-adjacent icon. It tracks temporary Control welding and hides outside the board, for touch, on blur/cancellation, in modals, and outside workshops.

Entered rune arrays draw their four outer charges as virtual conduits beyond the inner board, with edge-center port markers. The displayed world may be nested while the simulation remains rooted. Signal-panel hover highlights the source on its own board or the containing rune array visible on an ancestor board; sources outside the displayed subtree have no highlight.

PNG export crops the current rendered pixels to the visible grid, excluding the surround and virtual array ports. Respect pan, zoom, and fractional device-pixel ratios without resampling. It exports neither offscreen board areas nor a separately rerendered whole board.

## Verification

Use the running browser to inspect changed visuals on the board and any affected palette/ghost/thumbnail surfaces. Check orientations, weld seams, charge/state variants, small zoom, and display density when relevant. `tests/tile-renderer.test.ts`, `tests/body-cells.test.ts`, and `tests/canvas-renderer.test.ts` cover outline stability, render-cell population, fitting, cache invalidation, culling, and redraw behavior. Browser interaction regressions live in `e2e/`.
