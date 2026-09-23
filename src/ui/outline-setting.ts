import { tileAppearance } from "../render/appearance";

const OUTLINES_STORAGE_KEY = "factory2d.angular-outlines";

export function initializeOutlineSetting(button: HTMLButtonElement, onChange: () => void): void {
  tileAppearance.angularOutlines = window.localStorage.getItem(OUTLINES_STORAGE_KEY) === "true";
  button.setAttribute("aria-pressed", String(tileAppearance.angularOutlines));
  button.addEventListener("click", () => {
    const enabled = !tileAppearance.angularOutlines;
    try {
      window.localStorage.setItem(OUTLINES_STORAGE_KEY, String(enabled));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Could not save appearance settings: ${message}`);
      return;
    }
    tileAppearance.angularOutlines = enabled;
    button.setAttribute("aria-pressed", String(enabled));
    onChange();
  });
}
