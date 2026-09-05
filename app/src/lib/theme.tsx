"use client";

/**
 * Dark by default, light behind a toggle. The choice lives in localStorage and
 * on `<html data-theme>`; the root layout applies it before first paint.
 */

import { useCallback, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export const THEME_KEY = "livestock.theme";

export type Theme = "dark" | "light";

function read(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(read());
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = read() === "light" ? "dark" : "light";
    if (next === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      if (next === "light") localStorage.setItem(THEME_KEY, "light");
      else localStorage.removeItem(THEME_KEY);
    } catch {
      // Private mode or blocked storage: the toggle still works for the session.
    }
    setTheme(next);
  }, []);

  return [theme, toggle];
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, toggle] = useTheme();
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded bg-neutral-100 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-900 ${className}`}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}
