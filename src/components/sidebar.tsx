"use client";

import {
  Activity,
  BookOpenText,
  Building2,
  DatabaseZap,
  FileStack,
  History,
  LayoutDashboard,
  Map,
  Megaphone,
  Menu,
  ShieldCheck,
  Table2,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  { label: "Overview", items: [{ href: "/", label: "Command Center", icon: LayoutDashboard }] },
  {
    label: "Portfolio",
    items: [
      { href: "/projects", label: "Projects", icon: Building2 },
      { href: "/inventory", label: "Inventory Explorer", icon: Table2 },
      { href: "/pricing", label: "Pricing Intelligence", icon: Wallet },
      { href: "/geography", label: "Geographic Intelligence", icon: Map },
    ],
  },
  {
    label: "Market",
    items: [
      { href: "/market", label: "Market Intelligence", icon: TrendingUp },
      { href: "/timeline", label: "Public Announcements", icon: Megaphone },
    ],
  },
  {
    label: "Data management",
    items: [
      { href: "/sources", label: "Sources & Imports", icon: FileStack },
      { href: "/quality", label: "Data Quality", icon: ShieldCheck },
      { href: "/sources/runs", label: "Ingestion History", icon: History },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/methodology", label: "Methodology & Definitions", icon: BookOpenText },
      { href: "/system", label: "System Health", icon: Activity },
    ],
  },
];

const ALL = NAV_GROUPS.flatMap((g) => g.items);

/** The most specific nav entry whose path prefixes the current route. */
export function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const it of ALL) {
    const match = it.href === "/" ? pathname === "/" : pathname === it.href || pathname.startsWith(`${it.href}/`);
    if (match && (!best || it.href.length > best.length)) best = it.href;
  }
  return best;
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  return (
    <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const isActive = item.href === active;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                      isActive ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    {isActive ? <span aria-hidden className="absolute inset-y-1.5 -left-3 w-[3px] rounded-r bg-brand" /> : null}
                    <Icon aria-hidden className={`size-4 shrink-0 ${isActive ? "text-brand" : "text-muted"}`} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-5 py-4">
      <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-md border border-brand/40 bg-brand-soft font-display text-[15px] font-semibold text-brand">
        D
      </span>
      <span className="leading-tight">
        <span className="block font-display text-[15px] font-semibold tracking-tight text-ink">Danube BI</span>
        <span className="block text-[10.5px] uppercase tracking-[0.14em] text-muted">Intelligence Center</span>
      </span>
    </Link>
  );
}

function Footer() {
  return (
    <div className="border-t border-line px-5 py-3 text-[11px] leading-snug text-muted">
      <p className="flex items-center gap-1.5">
        <DatabaseZap aria-hidden className="size-3.5" /> Independent research tool
      </p>
      <p className="mt-0.5">No access to Danube internal systems.</p>
    </div>
  );
}

export function Sidebar() {
  return (
    <nav aria-label="Main" className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <Brand />
      <NavList />
      <Footer />
    </nav>
  );
}

/** Off-canvas navigation for tablet and phone widths. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex size-9 items-center justify-center rounded-md border border-line text-ink-2 hover:bg-surface-2 lg:hidden" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-nav">
        <Menu aria-hidden className="size-4.5" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-[var(--overlay)]" onClick={() => setOpen(false)} />
          <nav id="mobile-nav" aria-label="Main" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface shadow-panel">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2" aria-label="Close navigation">
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <NavList key={pathname} onNavigate={() => setOpen(false)} />
            <Footer />
          </nav>
        </div>
      ) : null}
    </>
  );
}
