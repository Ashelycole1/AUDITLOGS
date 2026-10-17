import { useSyncExternalStore } from "react";

// Light or dark. Until the person picks one, the app follows the system setting and changes with it.
// public/theme-init.js applies the same rule before first paint; keep the storage key in step.
export type Theme = "light" | "dark";

const KEY = "auditlogs.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#141110" : "#f3f2ed");
  listeners.forEach((l) => l());
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  apply(t);
}

apply(saved() ?? (media.matches ? "dark" : "light"));
media.addEventListener("change", (e) => {
  if (!saved()) apply(e.matches ? "dark" : "light");
});

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, currentTheme);
  return [theme, setTheme];
}
