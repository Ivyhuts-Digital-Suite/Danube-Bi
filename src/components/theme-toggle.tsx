"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

export const THEME_KEY = "danube-theme";

/** Runs before first paint (inlined in <head>) so the stored theme never flashes. Dark is the default. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}`;

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribe,
    () => document.documentElement.getAttribute("data-theme") ?? "dark",
    () => "dark",
  );
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.setAttribute("data-theme", next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          // Storage may be unavailable (private mode); the toggle still works for this page view.
        }
      }}
      className="inline-flex size-9 items-center justify-center rounded-md border border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}
    </button>
  );
}
