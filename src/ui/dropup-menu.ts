/**
 * A button that opens a list of options above itself. Owns only the open state and its
 * ARIA mirror; callers wire the clicks, keyboard handling, and outside-click closing.
 */
export class DropupMenu {
  constructor(
    readonly container: HTMLElement,
    readonly button: HTMLButtonElement,
    readonly options: HTMLElement,
  ) {}

  get open(): boolean {
    return !this.options.hidden;
  }

  setOpen(open: boolean): void {
    this.options.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
  }

  close(): void {
    this.setOpen(false);
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  /** Whether an event target lies inside the menu, for closing on outside clicks or focus loss. */
  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.container.contains(target);
  }
}
