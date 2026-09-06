const THEME_STORAGE_KEY = "factory2d.theme";

type Theme = "dark" | "light";

/** Theme affects the UI shell; tile artwork and circuit colors stay unchanged. */
export function initializeTheme(button: HTMLButtonElement): void {
  let theme: Theme = window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";

  function apply(): void {
    document.documentElement.dataset.theme = theme;
    button.setAttribute("aria-pressed", String(theme === "light"));
  }

  apply();
  button.addEventListener("click", () => {
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
  });
}
