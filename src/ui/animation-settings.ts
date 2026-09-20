const ANIMATIONS_STORAGE_KEY = "factory2d.animations";
const PAUSED_ANIMATIONS_STORAGE_KEY = "factory2d.animate-while-paused";

export function initializeAnimationSettings(
  toggle: HTMLInputElement,
  button: HTMLButtonElement,
  pausedButton: HTMLButtonElement,
  onChange: () => void,
): { readonly whilePaused: boolean } {
  let enabled = window.localStorage.getItem(ANIMATIONS_STORAGE_KEY) !== "false";
  let whilePaused = window.localStorage.getItem(PAUSED_ANIMATIONS_STORAGE_KEY) === "true";

  function refresh(): void {
    toggle.checked = enabled;
    button.setAttribute("aria-pressed", String(enabled));
    pausedButton.setAttribute("aria-pressed", String(whilePaused));
    pausedButton.disabled = !enabled;
  }

  function save(key: string, value: boolean): boolean {
    try {
      window.localStorage.setItem(key, String(value));
      return true;
    } catch (error) {
      refresh();
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Could not save animation settings: ${message}`);
      return false;
    }
  }

  function setEnabled(value: boolean): void {
    if (!save(ANIMATIONS_STORAGE_KEY, value)) return;
    enabled = value;
    refresh();
    onChange();
  }

  toggle.addEventListener("change", () => setEnabled(toggle.checked));
  button.addEventListener("click", () => setEnabled(!enabled));
  pausedButton.addEventListener("click", () => {
    if (!save(PAUSED_ANIMATIONS_STORAGE_KEY, !whilePaused)) return;
    whilePaused = !whilePaused;
    refresh();
    onChange();
  });
  refresh();
  return { get whilePaused() { return whilePaused; } };
}
