// Twelve equal-tempered semitones per octave, spanning F5 down to F2.
export const BELL_STEPS_PER_OCTAVE = 12;
export const BELL_PITCH_COUNT = 3 * BELL_STEPS_PER_OCTAVE + 1;

/** Zero-based pitch, descending as the welded/mechanically linked body grows. */
export function bellPitchForBodySize(size: number): number {
  return Math.max(1, Math.min(BELL_PITCH_COUNT, size)) - 1;
}
