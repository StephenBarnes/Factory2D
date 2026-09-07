const MIN_WIDTH = 188;
const MAX_WIDTH = 420;

/** Resize the shared workshop sidebar without changing the board camera. */
export function initializePaletteResize(
  screen: HTMLElement,
  sidebar: HTMLElement,
  handle: HTMLElement,
  redrawPreviews: () => void,
): void {
  let pointerId: number | null = null;
  let startX = 0;
  let startWidth = 0;
  let chosenWidth: number | null = null;
  const maximum = (): number => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, screen.clientWidth * 0.45));
  const width = (): number => sidebar.getBoundingClientRect().width;
  const resize = (value: number): void => {
    chosenWidth = Math.round(Math.max(MIN_WIDTH, Math.min(maximum(), value)));
    screen.style.setProperty("--sidebar-width", `${chosenWidth}px`);
  };
  const finish = (): void => {
    const captured = pointerId;
    pointerId = null;
    if (captured !== null && handle.hasPointerCapture(captured)) {
      handle.releasePointerCapture(captured);
    }
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointerId !== null) return;
    handle.focus();
    pointerId = event.pointerId;
    startX = event.clientX;
    startWidth = width();
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    if ((event.buttons & 1) === 0) {
      finish();
      return;
    }
    resize(startWidth + event.clientX - startX);
  });
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  window.addEventListener("blur", finish);
  handle.addEventListener("keydown", (event) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = width() - 8; break;
      case "ArrowRight": next = width() + 8; break;
      case "Home": next = MIN_WIDTH; break;
      case "End": next = maximum(); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    resize(next);
  });
  handle.addEventListener("dblclick", () => {
    chosenWidth = null;
    screen.style.removeProperty("--sidebar-width");
  });
  new ResizeObserver(() => {
    if (screen.clientWidth === 0) {
      finish();
      return;
    }
    if (chosenWidth !== null) resize(chosenWidth);
    handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
    handle.setAttribute("aria-valuemax", String(Math.round(maximum())));
    handle.setAttribute("aria-valuenow", String(Math.round(width())));
    redrawPreviews();
  }).observe(sidebar);
  window.addEventListener("resize", () => {
    if (chosenWidth !== null && screen.clientWidth > 0) resize(chosenWidth);
  });
}
