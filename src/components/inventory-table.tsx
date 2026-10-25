"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, ExternalLink, FileText, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { warningInfo } from "@/lib/inventory-analytics";

export interface UnitRow {
  id: string;
  unitNumber: string;
  project: string;
  projectAsListed: string;
  projectId: string | null;
  unitType: string | null;
  typology: string | null;
  areaSqFt: number | null;
  view: string | null;
  listedPriceAED: number | null;
  pricePerSqFt: number | null;
  status: string | null;
  statusNormalized: string | null;
  sourcePage: number;
  lineIndex: number;
  filename: string;
  snapshotDate: string | null;
  warnings: string[];
  original: Record<string, string>;
}

interface Column {
  id: string;
  label: string;
  sortKey?: string;
  numeric?: boolean;
  defaultVisible: boolean;
  render: (r: UnitRow) => React.ReactNode;
}

const num = (v: number | null, digits = 0) => (v == null ? <span className="text-muted">—</span> : v.toLocaleString("en-US", { maximumFractionDigits: digits }));

const STATUS_DOT: Record<string, string> = {
  available: "var(--series-1)",
  sold: "var(--series-2)",
  reserved: "var(--series-3)",
  other: "var(--series-4)",
};

function StatusCell({ r }: { r: UnitRow }) {
  if (!r.status) return <span className="text-muted">No status</span>;
  const unknown = r.statusNormalized === "other";
  return (
    <span className="inline-flex max-w-[12rem] items-center gap-1.5" title={unknown ? `Unrecognized label: “${r.status}”` : r.status}>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: STATUS_DOT[r.statusNormalized ?? ""] ?? "var(--series-muted)" }} />
      <span className={`truncate ${unknown ? "italic text-ink-2" : ""}`}>{r.status}</span>
    </span>
  );
}

function WarningCell({ r, onOpen }: { r: UnitRow; onOpen: () => void }) {
  const review = r.warnings.filter((w) => warningInfo(w).review);
  if (review.length === 0) return <span className="whitespace-nowrap text-xs text-muted">{r.warnings.length ? "Notes only" : "—"}</span>;
  const labels = [...new Set(review.map((w) => warningInfo(w).label))];
  return (
    <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 rounded text-left text-xs text-warn hover:underline" title={review.map((w) => `${warningInfo(w).label}: ${warningInfo(w).explanation}`).join("\n")}>
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      <span className="max-w-[11rem] truncate">{labels.join(", ")}</span>
    </button>
  );
}

const COLUMNS: Column[] = [
  { id: "unit", label: "Unit", sortKey: "unitNumber", defaultVisible: true, render: (r) => <span className="whitespace-nowrap font-medium text-ink">{r.unitNumber}</span> },
  {
    id: "project",
    label: "Project",
    sortKey: "projectNameAsListed",
    defaultVisible: true,
    render: (r) =>
      r.projectId ? (
        <Link href={`/projects/${r.projectId}`} onClick={(e) => e.stopPropagation()} className="block max-w-[14rem] truncate text-link hover:underline" title={r.projectAsListed}>
          {r.project}
        </Link>
      ) : (
        <span className="text-muted">No project</span>
      ),
  },
  { id: "typology", label: "Typology", sortKey: "typology", defaultVisible: true, render: (r) => <span className="block max-w-[12rem] truncate">{r.typology ?? <span className="text-muted">—</span>}</span> },
  { id: "unitType", label: "Unit type", sortKey: "unitType", defaultVisible: false, render: (r) => <span className="block max-w-[14rem] truncate">{r.unitType ?? <span className="text-muted">—</span>}</span> },
  { id: "area", label: "Size (sq ft)", sortKey: "areaSqFt", numeric: true, defaultVisible: true, render: (r) => num(r.areaSqFt) },
  { id: "view", label: "View", defaultVisible: false, render: (r) => <span className="block max-w-[14rem] truncate">{r.view ?? <span className="text-muted">—</span>}</span> },
  { id: "price", label: "Listed price (AED)", sortKey: "listedPriceAED", numeric: true, defaultVisible: true, render: (r) => num(r.listedPriceAED) },
  { id: "psf", label: "AED / sq ft", sortKey: "pricePerSqFt", numeric: true, defaultVisible: true, render: (r) => num(r.pricePerSqFt) },
  { id: "status", label: "Status (as printed)", sortKey: "status", defaultVisible: true, render: (r) => <StatusCell r={r} /> },
  {
    id: "source",
    label: "Source",
    sortKey: "sourcePage",
    defaultVisible: true,
    render: (r) => (
      <span className="block whitespace-nowrap text-xs">
        <span className="text-ink-2">
          {r.filename} p.{r.sourcePage}
        </span>
        <span className={`block ${r.snapshotDate ? "text-muted" : "text-warn"}`}>{r.snapshotDate ?? "Unknown date"}</span>
      </span>
    ),
  },
];

const STORAGE_KEY = "danube-inventory-columns";
const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);

// Visible columns are a per-viewer convenience kept in localStorage (falls back to defaults).
const listeners = new Set<() => void>();
function readColumns(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_VISIBLE.join(",");
  } catch {
    return DEFAULT_VISIBLE.join(",");
  }
}
function writeColumns(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, ids.join(","));
  } catch {
    // Storage unavailable: the change lasts until reload.
  }
  listeners.forEach((l) => l());
}
function subscribeColumns(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function InventoryTable({ rows, query, sort, dir }: { rows: UnitRow[]; query: string; sort: string; dir: "asc" | "desc" }) {
  const stored = useSyncExternalStore(subscribeColumns, readColumns, () => DEFAULT_VISIBLE.join(","));
  const visible = useMemo(() => new Set(stored.split(",").filter(Boolean)), [stored]);
  const columns = COLUMNS.filter((c) => visible.has(c.id));
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;

  const sortHref = (key: string) => {
    const p = new URLSearchParams(query);
    p.set("sort", key);
    p.set("dir", sort === key && dir === "asc" ? "desc" : "asc");
    p.delete("page");
    return `/inventory?${p.toString()}`;
  };

  return (
    <div className="rounded-panel border border-line bg-surface shadow-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs text-muted">Select a row for the full record, original extracted text and warnings.</p>
        <ColumnPicker visible={visible} />
      </div>
      <div className="scroll-thin max-h-[70vh] overflow-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              {columns.map((c) => {
                const active = c.sortKey && c.sortKey === sort;
                const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                    className={`sticky top-0 z-[1] border-b border-line bg-surface px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted whitespace-nowrap ${c.numeric ? "text-right" : "text-left"}`}
                  >
                    {c.sortKey ? (
                      <Link href={sortHref(c.sortKey)} className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`}>
                        {c.label}
                        <Icon aria-hidden className={`size-3 ${active ? "" : "opacity-40"}`} />
                      </Link>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
              <th scope="col" className="sticky top-0 z-[1] border-b border-line bg-surface px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                Checks
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => setOpenId(r.id)}
                className={`cursor-pointer border-b border-line last:border-0 hover:bg-surface-2 ${openId === r.id ? "bg-surface-2" : ""}`}
              >
                {columns.map((c, i) => (
                  <td key={c.id} className={`px-3 py-2 align-middle ${c.numeric ? "tabular text-right whitespace-nowrap" : ""}`}>
                    {i === 0 ? (
                      <button type="button" className="text-left hover:underline" onClick={(e) => (e.stopPropagation(), setOpenId(r.id))} aria-label={`Open details for unit ${r.unitNumber}`}>
                        {c.render(r)}
                      </button>
                    ) : (
                      c.render(r)
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 align-middle" onClick={(e) => e.stopPropagation()}>
                  <WarningCell r={r} onOpen={() => setOpenId(r.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? <UnitDrawer row={open} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function ColumnPicker({ visible }: { visible: Set<string> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-ink-2 hover:bg-surface-2">
        <Columns3 aria-hidden className="size-3.5" /> Columns
      </button>
      {open ? (
        <fieldset className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-line-strong bg-surface-3 p-2 shadow-panel">
          <legend className="sr-only">Visible columns</legend>
          {COLUMNS.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-ink-2 hover:bg-surface-2">
              <input
                type="checkbox"
                checked={visible.has(c.id)}
                disabled={c.id === "unit"}
                onChange={(e) => {
                  const next = new Set(visible);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  writeColumns(COLUMNS.filter((x) => next.has(x.id)).map((x) => x.id));
                }}
                className="accent-[var(--series-1)]"
              />
              {c.label}
            </label>
          ))}
          <button type="button" onClick={() => writeColumns(DEFAULT_VISIBLE)} className="mt-1 w-full rounded px-1.5 py-1 text-left text-xs text-link hover:bg-surface-2">
            Reset to default
          </button>
        </fieldset>
      ) : null}
    </div>
  );
}

const ORIGINAL_LABELS: Record<string, string> = {
  serialNumber: "S.No",
  project: "Project",
  unitNumber: "Unit number",
  unitType: "Unit type",
  typology: "Typology",
  areaSqFt: "Size",
  view: "View",
  listedPriceAED: "Price",
  status: "Status",
  _line: "Full extracted line",
};

function UnitDrawer({ row: r, onClose }: { row: UnitRow; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const fields: Array<[string, React.ReactNode]> = [
    ["Project", r.project],
    ["Project as listed", r.projectAsListed || "—"],
    ["Typology", r.typology ?? "—"],
    ["Unit type", r.unitType ?? "—"],
    ["View", r.view ?? "—"],
    ["Size", r.areaSqFt != null ? `${r.areaSqFt.toLocaleString("en-US", { maximumFractionDigits: 1 })} sq ft` : "Not available"],
    ["Listed price", r.listedPriceAED != null ? `AED ${r.listedPriceAED.toLocaleString("en-US")}` : "Not available"],
    ["AED / sq ft (calculated)", r.pricePerSqFt != null ? r.pricePerSqFt.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "Needs a valid price and size"],
    ["Status as printed", r.status ?? "No status"],
    ["Status read as", r.statusNormalized ?? "missing"],
  ];
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={`unit-${r.id}`}>
      <button type="button" aria-label="Close details" className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} />
      <aside className="scroll-thin absolute inset-y-0 right-0 flex w-[min(30rem,100vw)] flex-col overflow-y-auto border-l border-line-strong bg-surface shadow-panel">
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Unit record</p>
            <h2 id={`unit-${r.id}`} className="font-display text-xl font-semibold text-ink">
              {r.unitNumber}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
              <FileText aria-hidden className="size-3.5" /> {r.filename}, page {r.sourcePage}, line {r.lineIndex} ·{" "}
              <span className={r.snapshotDate ? "" : "text-warn"}>{r.snapshotDate ?? "Unknown snapshot date"}</span>
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2" aria-label="Close">
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="space-y-5 px-5 py-4">
          {r.warnings.length ? (
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Validation</h3>
              <ul className="space-y-2">
                {[...new Set(r.warnings)].map((w) => {
                  const info = warningInfo(w);
                  return (
                    <li key={w} className={`rounded-md border px-3 py-2 text-xs ${info.review ? "border-warn/35 bg-warn-soft" : "border-line bg-surface-2"}`}>
                      <p className={`font-medium ${info.review ? "text-warn" : "text-ink"}`}>
                        {info.review ? "Review · " : ""}
                        {info.label}
                      </p>
                      <p className="mt-0.5 text-ink-2">{info.explanation}</p>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Values used in calculations</h3>
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1.5 text-sm">
              {fields.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-2">{k}</dt>
                  <dd className="tabular min-w-0 break-words text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Original extracted text</h3>
            <dl className="space-y-1.5 rounded-md border border-line bg-surface-2 p-3 text-xs">
              {Object.entries(r.original).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-2">
                  <dt className="text-muted">{ORIGINAL_LABELS[k] ?? k}</dt>
                  <dd className="break-all font-mono text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <Link href={`/inventory/${r.id}`} className="inline-flex items-center gap-1.5 text-sm text-link hover:underline">
            Full record and history across snapshots <ExternalLink aria-hidden className="size-3.5" />
          </Link>
        </div>
      </aside>
    </div>
  );
}
