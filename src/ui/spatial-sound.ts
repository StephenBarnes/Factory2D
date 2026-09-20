import type { CameraView } from "../render/canvas-renderer";
import type { World } from "../simulation/world";
import { WorldFeature } from "../simulation/world-features";

/** A committed sound site in its own board; never simulation state. */
export interface LocatedSound<Voice> {
  readonly voice: Voice;
  readonly world: World;
  readonly index: number;
}

export interface SoundView extends CameraView {
  readonly world: World;
  readonly width: number;
  readonly height: number;
}

export interface SoundPosition {
  readonly pan: number;
  readonly gain: number;
}

/** CSS-pixel camera geometry, independent of backing-store density. */
export function soundPosition(view: SoundView, x: number, y: number): SoundPosition {
  const dx = (x - view.centerX) * view.cellSize / Math.max(1, view.width / 2);
  const dy = (y - view.centerY) * view.cellSize / Math.max(1, view.height / 2);
  return {
    pan: Math.max(-1, Math.min(1, dx)),
    // Pulling back quiets the board; neither zoom nor source count amplifies it.
    gain: Math.min(1, view.cellSize / 32) / (1 + dx * dx + dy * dy),
  };
}

/** Keep one bounded voice per pitch/type, at its loudest audible site. */
export function spatialSounds<Voice>(
  events: readonly LocatedSound<Voice>[],
  view: SoundView,
): ReadonlyMap<Voice, SoundPosition> {
  const voices = new Map<Voice, SoundPosition>();
  if (events.length === 0) return voices;
  const sites = new Map<World, number>();
  const visit = (world: World, containingIndex: number): void => {
    for (
      let index = world.firstFeatureIndex(WorldFeature.RuneArray);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.RuneArray, index)
    ) {
      const child = world.runeArrayWorldAtIndex(index);
      const site = world === view.world ? index : containingIndex;
      sites.set(child, site);
      visit(child, site);
    }
  };
  if (events.some((event) => event.world !== view.world)) visit(view.world, -1);
  for (const event of events) {
    const index = event.world === view.world ? event.index : sites.get(event.world);
    // Ancestors and sibling arrays are outside the displayed board's soundscape.
    if (index === undefined) continue;
    const position = soundPosition(view, index % view.world.width + 0.5,
      Math.floor(index / view.world.width) + 0.5);
    const previous = voices.get(event.voice);
    if (previous === undefined || position.gain > previous.gain) voices.set(event.voice, position);
  }
  return voices;
}
