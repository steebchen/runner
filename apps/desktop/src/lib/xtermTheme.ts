import type { Terminal } from "@xterm/xterm";

export function xtermTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { background: v("--bg"), foreground: v("--fg"), cursor: v("--fg"), selectionBackground: v("--hover") };
}

/** Keep a terminal's colors in sync with the app theme. Returns an unsubscribe fn. */
export function followTheme(term: Terminal) {
  const update = () => (term.options.theme = xtermTheme());
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("runner-theme", update);
  media.addEventListener("change", update);
  return () => {
    window.removeEventListener("runner-theme", update);
    media.removeEventListener("change", update);
  };
}
