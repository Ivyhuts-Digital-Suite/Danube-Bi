import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, DataError, EmptyState, loadDb, PageHeader, Skeleton } from "@/components/ui";
import { fmtAED, fmtDate } from "@/lib/format";
import { globalSearch } from "@/server/queries/catalog";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage(props: PageProps<"/search">) {
  return (
    <>
      <PageHeader eyebrow="Search" title="Search results" description="Projects (names and aliases), unit numbers in current snapshots, recorded announcements and brochure page text." />
      <Suspense fallback={<Skeleton />}>
        <Results searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  if (q.trim().length < 2) return <EmptyState title="Type at least two characters in the search box above" />;
  const r = await loadDb(() => globalSearch(q));
  if (!r.ok) return <DataError error={r.error} />;
  const res = r.data!;
  const total = res.projects.length + res.units.length + res.events.length + res.pages.length;
  if (total === 0) return <EmptyState title={`No results for "${res.q}"`} />;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title={`Projects (${res.projects.length})`}>
        <ul className="space-y-1 text-sm">
          {res.projects.map((p) => (
            <li key={String(p._id)}><Link className="text-accent hover:underline" href={`/projects/${p._id}`}>{p.name}</Link></li>
          ))}
        </ul>
      </Card>
      <Card title={`Units (${res.units.length}${res.units.length === 20 ? "+" : ""})`}>
        <ul className="space-y-1 text-sm">
          {res.units.map((u) => (
            <li key={String(u._id)}>
              <Link className="text-accent hover:underline" href={`/inventory/${u._id}`}>{u.unitNumber}</Link>{" "}
              <span className="text-ink-2">{u.projectNameAsListed} · {fmtAED(u.listedPriceAED)} (listed) · {u.status ?? "—"}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`Announcements (${res.events.length})`}>
        <ul className="space-y-1 text-sm">
          {res.events.map((e) => (
            <li key={String(e._id)}>
              <Link className="text-accent hover:underline" href="/timeline">{e.title}</Link> <span className="text-xs text-muted">{e.publisher} · {fmtDate(e.publicationDate)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`Brochure pages (${res.pages.length})`}>
        <ul className="space-y-2 text-sm">
          {res.pages.map((p) => (
            <li key={String(p._id)}>
              <p className="text-xs text-muted">Page {p.page}{p.detectedNames.length ? ` · ${p.detectedNames.join(", ")}` : ""}</p>
              <p className="text-ink-2">…{p.snippet}…</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
