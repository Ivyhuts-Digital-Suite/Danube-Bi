"use client";

import { Building2, CornerDownLeft, LoaderCircle, Search, SquareStack } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

interface Suggestion {
  kind: "project" | "unit";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Global search over projects (name and aliases) and unit numbers, backed by /api/search.
 * Arrow keys move through suggestions, Enter opens one, or opens the full results page.
 */
export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) {
          setItems(((await res.json()) as { items: Suggestion[] }).items);
          setActive(-1);
        }
      } catch {
        // Aborted or offline: keep the previous suggestions.
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const shown = q.trim().length >= 2 ? items : [];
  const go = (href: string) => {
    setOpen(false);
    inputRef.current?.blur();
    router.push(href);
  };

  return (
    <div className="relative w-full max-w-lg">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (active >= 0 && shown[active]) go(shown[active].href);
          else if (q.trim().length >= 2) go(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <label htmlFor="global-search" className="sr-only">
          Search projects and unit numbers
        </label>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          id="global-search"
          role="combobox"
          aria-expanded={open && shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={q}
          maxLength={100}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(shown.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search projects or unit numbers…"
          className="h-9 w-full rounded-md border border-line bg-surface-2 pl-9 pr-16 text-sm text-ink placeholder:text-muted focus-visible:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-0"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 sm:flex">
          {loading ? <LoaderCircle aria-hidden className="size-3.5 animate-spin text-muted" /> : null}
          <kbd className="rounded border border-line-strong px-1.5 text-[10px] text-muted">Ctrl K</kbd>
        </span>
      </form>
      {open && q.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-lg border border-line-strong bg-surface shadow-panel">
          {shown.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">{loading ? "Searching…" : "No matching projects or units."}</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Search suggestions" className="max-h-80 overflow-y-auto py-1">
              {shown.map((s, i) => {
                const Icon = s.kind === "project" ? Building2 : SquareStack;
                return (
                  <li key={`${s.kind}-${s.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(s.href)}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === active ? "bg-surface-3" : "hover:bg-surface-2"}`}
                    >
                      <Icon aria-hidden className="size-4 shrink-0 text-muted" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">{s.title}</span>
                        <span className="block truncate text-xs text-muted">{s.subtitle}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => go(`/search?q=${encodeURIComponent(q.trim())}`)}
            className="flex w-full items-center justify-between border-t border-line px-3 py-2 text-xs text-ink-2 hover:bg-surface-2"
          >
            <span>All results for “{q.trim()}” — including brochure text and announcements</span>
            <CornerDownLeft aria-hidden className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
