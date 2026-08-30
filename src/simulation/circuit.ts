export type Charge = -1 | 0 | 1;

export const CIRCUIT_CHARGE_COLORS: Readonly<Record<Charge, string>> = {
  [-1]: "#ef5350",
  [0]: "#382b55",
  [1]: "#3aa7ff",
};

export function chargeFromSum(sum: number): Charge {
  return sum < 0 ? -1 : sum > 0 ? 1 : 0;
}

export function isCharge(value: number): value is Charge {
  return value === -1 || value === 0 || value === 1;
}
