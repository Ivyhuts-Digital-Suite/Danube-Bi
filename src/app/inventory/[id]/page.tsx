import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, ClaimBadge, DataError, loadDb, Notice, PageHeader, Skeleton, td, tdNum, th } from "@/components/ui";
import { fmtAED, fmtDate, fmtDateTime, fmtNum1 } from "@/lib/format";
import { getUnit } from "@/server/queries/inventory";

export const metadata: Metadata = { title: "Unit record" };

export default function UnitPage(props: PageProps<"/inventory/[id]">) {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <UnitDetail params={props.params} />
    </Suspense>
  );
}

const FIELD_LABELS: Record<string, string> = {
  serialNumber: "Serial number",
  project: "Project",
  unitNumber: "Unit number",
  unitType: "Unit type",
  typology: "Typology",
  areaSqFt: "Size",
  view: "View",
  listedPriceAED: "Listed price",
  status: "Status",
  _line: "Full extracted line",
};

async function UnitDetail({ params }: { params: PageProps<"/inventory/[id]">["params"] }) {
  const { id } = await params;
  const r = await loadDb(() => getUnit(id));
  if (!r.ok) return <DataError error={r.error} />;
  if (!r.data) notFound();
  const { obs, snapshot, history } = r.data;
  const original = obs.originalValues as Record<string, string>;
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Unit ${obs.unitNumber}`}
        description={
          <>
            {obs.projectId ? <Link className="text-accent underline" href={`/projects/${obs.projectId._id}`}>{obs.projectId.name}</Link> : "No project recorded"} · Source:{" "}
            {obs.sourceDocumentId?.filename} page {obs.sourcePage} · Snapshot {snapshot?.snapshotDateStatus === "from_document" ? `dated ${fmtDate(snapshot.snapshotDate)}` : "date unknown"}
          </>
        }
      />
      {obs.validationWarnings.length ? (
        <Notice tone="warn">Validation warnings: {obs.validationWarnings.map((w) => w.replace(/_/g, " ")).join("; ")}</Notice>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Normalized values" subtitle="Used for calculations">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-2">Listed price <ClaimBadge type="listed_price" /></dt>
            <dd className="tabular">{fmtAED(obs.listedPriceAED)}</dd>
            <dt className="text-ink-2">Size (sq ft)</dt>
            <dd className="tabular">{fmtNum1(obs.areaSqFt)}</dd>
            <dt className="text-ink-2">Price per sq ft <ClaimBadge type="calculated" /></dt>
            <dd className="tabular">{obs.pricePerSqFt != null ? `AED ${fmtNum1(obs.pricePerSqFt)}` : "— (needs price and size)"}</dd>
            <dt className="text-ink-2">Status (as recorded)</dt>
            <dd>{obs.status ?? "—"} <span className="text-xs text-muted">→ {obs.statusNormalized ?? "missing"}</span></dd>
            <dt className="text-ink-2">Typology / type</dt>
            <dd>{obs.typology ?? "—"} / {obs.unitType ?? "—"}</dd>
            <dt className="text-ink-2">View</dt>
            <dd>{obs.view ?? "—"}</dd>
          </dl>
        </Card>
        <Card title="Original extracted values" subtitle={`Exactly as read from ${obs.sourceDocumentId?.filename} p.${obs.sourcePage} (sha256 ${obs.sourceDocumentId?.sha256.slice(0, 12)}…)`}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {Object.entries(original).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-2">{FIELD_LABELS[k] ?? k}</dt>
                <dd className="font-mono text-xs break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
      <Card title="This unit across snapshots" subtitle="Matched by project and normalized unit number; each row keeps its own document and date">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Document</th>
                <th className={th}>Snapshot date</th>
                <th className={th}>Imported</th>
                <th className={`${th} text-right`}>Listed price</th>
                <th className={th}>Status</th>
                <th className={th}>Page</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={String(h._id)} className={String(h._id) === String(obs._id) ? "bg-accent-soft" : ""}>
                  <td className={td}>{h.snapshot?.sourceDocumentId?.filename ?? "—"}{h.snapshot?.superseded ? " (older extraction)" : ""}</td>
                  <td className={td}>{h.snapshot?.snapshotDateStatus === "from_document" ? fmtDate(h.snapshot.snapshotDate) : "unknown"}</td>
                  <td className={td}>{fmtDateTime(h.snapshot?.importedAt)}</td>
                  <td className={tdNum}>{fmtAED(h.listedPriceAED)}</td>
                  <td className={td}>{h.status ?? "—"}</td>
                  <td className={td}>{h.sourcePage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
