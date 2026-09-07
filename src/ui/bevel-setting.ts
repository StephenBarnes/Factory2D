import { tileAppearance } from "../render/appearance";

const BEVELS_STORAGE_KEY = "factory2d.bevels";

export function initializeBevelSetting(button: HTMLButtonElement, onChange: () => void): void {
  tileAppearance.bevels = window.localStorage.getItem(BEVELS_STORAGE_KEY) !== "false";
  button.setAttribute("aria-pressed", String(tileAppearance.bevels));
  button.addEventListener("click", () => {
    const enabled = !tileAppearance.bevels;
    try {
      window.localStorage.setItem(BEVELS_STORAGE_KEY, String(enabled));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Could not save appearance settings: ${message}`);
      return;
    }
    tileAppearance.bevels = enabled;
    button.setAttribute("aria-pressed", String(enabled));
    onChange();
  });
}
