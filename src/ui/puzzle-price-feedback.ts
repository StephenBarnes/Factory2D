import { CIRCUIT_CHARGE_COLORS } from "../simulation/circuit";

const FEEDBACK_DURATION_MS = 1400;

/** Transient feedback for baseline edits, never simulation or session changes. */
export class PuzzlePriceFeedback {
  private price: number | null = null;
  private delta = 0;
  private expiresAt = 0;
  private animation: Animation | null = null;

  constructor(private readonly element: HTMLElement) {}

  update(price: number | null, edited: boolean): void {
    const previousPrice = this.price;
    this.price = price;
    if (!edited || price === null || previousPrice === null) {
      this.animation?.cancel();
      this.animation = null;
      this.delta = 0;
      this.expiresAt = 0;
      this.element.textContent = "";
      return;
    }
    const change = price - previousPrice;
    if (change === 0) return;

    const now = performance.now();
    this.delta = (now < this.expiresAt ? this.delta : 0) + change;
    this.animation?.cancel();
    this.animation = null;
    if (this.delta === 0) {
      this.expiresAt = 0;
      this.element.textContent = "";
      return;
    }

    this.expiresAt = now + FEEDBACK_DURATION_MS;
    this.element.textContent = `${this.delta > 0 ? "+" : ""}${this.delta}⚙`;
    this.element.style.color = CIRCUIT_CHARGE_COLORS[this.delta > 0 ? 1 : -1];
    this.animation = this.element.animate(
      [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0, offset: 1 }],
      { duration: FEEDBACK_DURATION_MS, easing: "ease-out" },
    );
  }
}
