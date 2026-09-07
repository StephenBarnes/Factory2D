# Rendering reference

For tile appearance, Canvas geometry, animation, and rendering performance. DOM controls and session ownership are covered in [UI/lifecycle](ui-lifecycle.md); physical behavior belongs in [simulation](simulation.md).

## Shared rendering and style

* `src/render/tile-renderer.ts` draws procedural tiles and welded bodies for the board, palette, placement/selection previews, snippets, and configuration thumbnails. Reuse it instead of building a second visual implementation.
* `src/simulation/tile.ts` supplies tile metadata and colors. `src/styles.css` owns the dwarven stone/bronze/gold/ember/gem palette in CSS custom properties and the serif display stack. Use existing styles and controls rather than creating a separate theme.
* `src/render/body-cells.ts` populates render cells from a world and collects bodies for small thumbnails. Render configurable/runtime state through the same shared path so previews match placed components.

Welded bodies use traced inset rounded-slab outlines, shadows, per-cell fills, clipped decorations, and directional bevel lighting. Neighbor cells merge only across locally welded edges: unwelded cuts must remain visible and stable even when another cut splits a body. Closed seam ends are rounded; diagonal contacts form rounded pinches. Mixed-kind fills remain locally stable when bodies merge or split.

Circuit traces follow actual welded circuit connections and each port's resolved charge; crossing axes and isolated outputs must not collapse into one shared color. Directional markers and short traces must not overlap. Stateful decorations display live buffers, cursors, verdicts, grips, and nested contents. Inspect existing drawing helpers before adding a new component.

Sensor glyphs share an angular eye with a charge-colored diamond or lightning-bolt pupil; their fills are purple. Three-input arithmetic transforms use teal/blue fills. Fixed sources use three charge-colored bolts, inverters use Hagalaz, rectifiers use Thurisaz, and victory stones use Jera. Directional glyphs rotate with their ports; the subtractor's rear plus marks the positive input.

Platforms use forest green; ROMs and graphers use jade/teal. Delay, counter, monitor, and array fills use sapphire/indigo, while fixed-charge/spark sources and sequence checkers use gold/amber. Channels and crossings retain neutral slate so wiring stays quieter than active components. These colors come from the shared tile metadata and are identical in both UI themes.

## Board, camera, and caches

`src/render/canvas-renderer.ts` owns grid rendering, hit testing, pan/zoom, interpolation, previews, hover overlays, and editable-region/array framing.

* The canvas occupies the region left after the palette and bottom controls. Fit the whole grid centered in the actual canvas, including subpixel tile sizes for maximum-size boards. Workshop entry and scene import reset the fit.
* Wheel zoom anchors under the pointer. Pan bounds keep the canvas center over the grid. Account for CSS size, backing-store density, pan, and zoom consistently in hit tests and drawing.
* Body membership and `Path2D` outlines are cached by geometry revision and scale, with localized rebuilding after edits. Visual-only updates reuse paths. Detailed rendering culls offscreen cells; low-detail rendering batches work. Unchanged frames can be skipped, except ongoing animation such as active belts.
* Palette and thumbnail backing stores are density-aware and supersampled. Palette previews redraw when display density/browser zoom changes or the resizable sidebar changes size; component icons scale with sidebar width.
* The UI passes its light-mode setting to each render, including the PNG export render. Theme changes invalidate the frame without rebuilding body geometry; the canvas surround, board fill, grid lines, and root border switch palettes. Tile artwork and signal colors stay unchanged, including in nested views.

Do not rebuild body topology or allocate fresh paths every animation frame. Preserve the separation of geometry and visual revisions when adding visual state or invalidation.

## Animation and overlays

Interpolation uses stable tile IDs between adjacent previous/current committed worlds and never changes physics. Piston arm IDs follow the head and support extension/retraction decoration animation; the extending shaft's rear endpoint stays at the base anchor until its full length fits ahead of the base. Automatic steps can batch between frames; rates at or above 60 ticks/second force discrete rendering without changing the player's animation preference. Rotator commits are implemented, but pivot-based quarter-circle animation is still a roadmap item.

Placed-component overlays use the hovered world's actual kind/orientation, including fixed or simulation-locked tiles; placement overlays use ghost orientation. The shared dispatcher handles welder/splitter target edges, occupancy-sensor observation cells, and rotator grip/sweep hints. Clear overlays with hover and clip to board bounds. Selection previews retain transformed welds and configurable appearance; invalid destinations show invalid feedback rather than modifying fixed cells.

`src/ui/tool-cursor.ts` uses the shared tile renderer and complete palette tool swatches for a small pointer-adjacent icon. It tracks temporary Control welding and hides outside the board, for touch, on blur/cancellation, in modals, and outside workshops.

Entered rune arrays draw their four outer charges as virtual conduits beyond the inner board, with edge-center port markers. The displayed world may be nested while the simulation remains rooted. Signal-panel hover only maps root signal IDs to root-board highlights.

PNG export crops the current rendered pixels to the visible grid, excluding the surround and virtual array ports. Respect pan, zoom, and fractional device-pixel ratios without resampling. It exports neither offscreen board areas nor a separately rerendered whole board.

## Verification

Use the running browser to inspect changed visuals on the board and any affected palette/ghost/thumbnail surfaces. Check orientations, weld seams, charge/state variants, small zoom, and display density when relevant. `tests/tile-renderer.test.ts`, `tests/body-cells.test.ts`, and `tests/canvas-renderer.test.ts` cover outline stability, render-cell population, fitting, cache invalidation, culling, and redraw behavior. Browser interaction regressions live in `e2e/`.
