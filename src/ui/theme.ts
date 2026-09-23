const THEME_STORAGE_KEY = "factory2d.theme";

type Theme = "dark" | "light";

/** Keeps the settings, workshop, and main-menu theme controls in sync. */
export function initializeTheme(
  button: HTMLButtonElement,
  workshopButton: HTMLButtonElement,
  menuButton: HTMLButtonElement,
) {
  let theme: Theme = window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  const shortcuts = [workshopButton, menuButton];
  const browserThemeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  function apply(): void {
    document.documentElement.dataset.theme = theme;
    if (browserThemeColor === null) throw new Error("Missing browser theme-color meta tag");
    browserThemeColor.setAttribute("content", theme === "light" ? "#decbb0" : "#27160b");
    button.setAttribute("aria-pressed", String(theme === "light"));
    const action = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
    for (const shortcut of shortcuts) {
      shortcut.textContent = theme === "light" ? "☀" : "☾";
      shortcut.setAttribute("aria-label", action);
      shortcut.title = action;
    }
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
  menuButton.addEventListener("click", toggle);
  return {
    get isLight(): boolean {
      return theme === "light";
    },
  };
}
