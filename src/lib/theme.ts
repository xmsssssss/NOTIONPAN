export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "notionpan-theme";

export function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function readStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    // ignore
  }
  return null;
}

export function resolveTheme(stored?: ThemeMode | null): ThemeMode {
  return stored ?? getSystemTheme();
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  root.style.colorScheme = mode;
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", mode === "dark" ? "#0b1220" : "#4f7cff");
    }
  } catch {
    // ignore
  }
}

export function setTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
  applyTheme(mode);
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  const next: ThemeMode = current === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

/** 内联到 layout，避免首屏闪白 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var s=localStorage.getItem(k);var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var m=s==='dark'||s==='light'?s:(d?'dark':'light');var r=document.documentElement;if(m==='dark')r.classList.add('dark');else r.classList.remove('dark');r.style.colorScheme=m;}catch(e){}})();`;
