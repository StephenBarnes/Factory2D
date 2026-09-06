const THEME_STORAGE_KEY = "factory2d.theme";

type Theme = "dark" | "light";

/** Keeps both theme controls in sync; tile artwork and circuit colors stay unchanged. */
export function initializeTheme(button: HTMLButtonElement, workshopButton: HTMLButtonElement) {
  let theme: Theme = window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";

  function apply(): void {
    document.documentElement.dataset.theme = theme;
    button.setAttribute("aria-pressed", String(theme === "light"));
    const action = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
    workshopButton.textContent = theme === "light" ? "☾" : "☀";
    workshopButton.setAttribute("aria-label", action);
    workshopButton.title = action;
  }

  apply();
  function toggle(): void {
    const nextTheme = theme === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Could not save appearance settings: ${message}`);
      return;
    }
    theme = nextTheme;
    apply();
  }

  button.addEventListener("click", toggle);
  workshopButton.addEventListener("click", toggle);
  return {
    get isLight(): boolean {
      return theme === "light";
    },
  };
}
