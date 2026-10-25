"use client";

import Link from "next/link";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { th } from "./styles";

export interface UnitRow {
  id: string;
  unitNumber: string;
  project: string;
  projectId: string | null;
  unitType: string;
  typology: string;
  areaSqFt: number | null;
  view: string;
  listedPriceAED: number | null;
  pricePerSqFt: number | null;
  status: string;
  sourcePage: number;
  warnings: string[];
}

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, UnitRow>();
const num = (v: number | null, digits = 0) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits }));

const columns = helper.columns([
  helper.accessor("unitNumber", {
    header: "Unit",
    cell: (c) => (
      <Link href={`/inventory/${c.row.original.id}`} className="font-medium text-accent hover:underline">
        {c.getValue()}
      </Link>
    ),
  }),
  helper.accessor("project", { header: "Project (as listed)" }),
  helper.accessor("typology", { header: "Typology" }),
  helper.accessor("unitType", { header: "Unit type" }),
  helper.accessor("areaSqFt", { header: "Size (sq ft)", cell: (c) => num(c.getValue()) }),
  helper.accessor("view", { header: "View" }),
  helper.accessor("listedPriceAED", { header: "Listed price (AED)", cell: (c) => num(c.getValue()) }),
  helper.accessor("pricePerSqFt", { header: "AED / sq ft", cell: (c) => num(c.getValue(), 0) }),
  helper.accessor("status", { header: "Status (in document)" }),
  helper.accessor("sourcePage", { header: "Page" }),
  helper.accessor("warnings", {
    header: "Checks",
    cell: (c) => (c.getValue().length ? <span title={c.getValue().join(", ")} className="text-warn">⚠ {c.getValue().length}</span> : <span className="text-muted">—</span>),
  }),
]);

/** Columns whose header links re-sort on the server. Keys match the server's whitelist. */
const SORT_KEYS: Record<string, string> = {
  unitNumber: "unitNumber",
  project: "projectNameAsListed",
  typology: "typology",
  unitType: "unitType",
  areaSqFt: "areaSqFt",
  listedPriceAED: "listedPriceAED",
  pricePerSqFt: "pricePerSqFt",
  status: "status",
  sourcePage: "sourcePage",
};
const NUMERIC = new Set(["areaSqFt", "listedPriceAED", "pricePerSqFt", "sourcePage"]);

export function InventoryTable({ rows, query, sort, dir }: { rows: UnitRow[]; query: string; sort: string; dir: "asc" | "desc" }) {
  const table = useTable({ features, columns, data: rows });
  const sortHref = (key: string) => {
    const p = new URLSearchParams(query);
    p.set("sort", key);
    p.set("dir", sort === key && dir === "asc" ? "desc" : "asc");
    p.delete("page");
    return `/inventory?${p.toString()}`;
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const key = SORT_KEYS[header.column.id];
                const active = key && key === sort;
                return (
                  <th
                    key={header.id}
                    className={`${th} ${NUMERIC.has(header.column.id) ? "text-right" : ""}`}
                    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {key ? (
                      <Link href={sortHref(key)} className="hover:text-ink">
                        <table.FlexRender header={header} />
                        {active ? (dir === "asc" ? " ▲" : " ▼") : ""}
                      </Link>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface-2">
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className={`border-b border-line px-3 py-2 ${NUMERIC.has(cell.column.id) ? "tabular text-right whitespace-nowrap" : ""}`}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
