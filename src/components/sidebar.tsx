"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/", label: "Command Center" },
  { href: "/projects", label: "Project Portfolio" },
  { href: "/inventory", label: "Inventory Explorer" },
  { href: "/pricing", label: "Pricing Intelligence" },
  { href: "/market", label: "Market Intelligence" },
  { href: "/timeline", label: "Announcements" },
  { href: "/sources", label: "Sources & Imports" },
  { href: "/quality", label: "Data Quality" },
  { href: "/methodology", label: "Methodology" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 left-4 z-30 rounded-full border border-line bg-surface px-4 py-2 text-sm shadow md:hidden"
        aria-expanded={open}
        aria-controls="app-nav"
      >
        {open ? "Close menu" : "Menu"}
      </button>
      <nav
        id="app-nav"
        aria-label="Main"
        className={`${open ? "fixed inset-y-0 left-0 z-20 flex" : "hidden"} w-60 shrink-0 flex-col border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-screen`}
      >
        <div className="border-b border-line px-5 py-4">
          <p className="text-sm font-semibold tracking-tight">Danube BI</p>
          <p className="text-xs text-muted">Command Center</p>
        </div>
        <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`block rounded-md px-3 py-2 text-sm ${isActive(item.href) ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-surface-2"}`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-5 py-3 text-[11px] leading-snug text-muted">
          Local research tool. No access to Danube internal systems.
        </p>
      </nav>
    </>
  );
}
