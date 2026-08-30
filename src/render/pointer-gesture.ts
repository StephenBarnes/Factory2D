export type PointerGesture = "edit" | "pick-or-pan" | "pan";

const PAN_DRAG_THRESHOLD_PIXELS = 4;
const PAN_DRAG_THRESHOLD_SQUARED = PAN_DRAG_THRESHOLD_PIXELS * PAN_DRAG_THRESHOLD_PIXELS;

/** Maps a pointer press to the board gesture it can begin. */
export function pointerGesture(button: number, altKey: boolean): PointerGesture | null {
  if (button === 1) {
    return "pick-or-pan";
  }
  if (button === 2 && altKey) {
    return "pan";
  }
  if (button === 0 || button === 2) {
    return "edit";
  }
  return null;
}

/** Distinguishes a middle click from a middle-button pan without reacting to pointer jitter. */
export function exceedsPanDragThreshold(deltaX: number, deltaY: number): boolean {
  return deltaX * deltaX + deltaY * deltaY >= PAN_DRAG_THRESHOLD_SQUARED;
}
