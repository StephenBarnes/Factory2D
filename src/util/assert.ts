/**
 * Returns `value`, throwing when it is undefined.
 *
 * Use for lookups that are logically guaranteed to succeed (for example
 * checked indexed access). A violated expectation crashes loudly with a
 * descriptive message instead of silently continuing with a fallback.
 */
export function expectDefined<T>(value: T | undefined, description: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${description} to be defined`);
  }
  return value;
}
