"use client";

/**
 * The app wears the system's colour scheme. Nothing to choose: `<html
 * data-theme="light">` is set when the OS prefers light and absent otherwise,
 * which is what globals.css keys off. The root layout resolves it before first
 * paint; this hook keeps it in step if the OS changes while the page is open.
 */

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const QUERY = "(prefers-color-scheme: light)";

function current(): Theme {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches ? "light" : "dark";
}

function apply(theme: Theme) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
}

export function useTheme(): { theme: Theme } {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(current());
    const media = window.matchMedia(QUERY);
    const onChange = () => {
      const next = current();
      apply(next);
      setTheme(next);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return { theme };
}
