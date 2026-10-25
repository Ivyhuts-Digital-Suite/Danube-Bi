import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createEventAction, retractEventAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Card, ClaimBadge, DataError, EmptyState, input, loadDb, Notice, PageHeader, Skeleton } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { EVENT_TYPES } from "@/server/models";
import { listEvents, listProjects } from "@/server/queries/catalog";

export const metadata: Metadata = { title: "Announcements & Strategy Timeline" };

export default function TimelinePage(props: PageProps<"/timeline">) {
  return (
    <>
      <PageHeader
        title="Public Announcements & Strategy Timeline"
        description="Launches, payment-plan offers, handovers and other public events, each recorded by a person from a public source with its URL and publication date. Company statements are the company's own claims."
      />
      <Suspense fallback={<Skeleton rows={4} />}>
        <Timeline searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const CLAIM_OPTIONS = [
  ["official_public", "Official company statement / press release"],
  ["marketing_claim", "Marketing claim"],
  ["reported_public", "Independent third-party reporting"],
  ["unverified", "Unverified"],
] as const;

async function Timeline({ searchParams }: { searchParams: PageProps<"/timeline">["searchParams"] }) {
  const sp = await searchParams;
  const type = typeof sp.type === "string" && (EVENT_TYPES as readonly string[]).includes(sp.type) ? sp.type : undefined;
  const showRetracted = sp.retracted === "1";
  const r = await loadDb(async () => ({ events: await listEvents({ type, includeRetracted: showRetracted }), projects: await listProjects() }));
  if (!r.ok) return <DataError error={r.error} />;
  const { events, projects } = r.data;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <nav aria-label="Filter by type" className="flex flex-wrap gap-2 text-xs">
          <Link href="/timeline" className={`rounded-full border px-3 py-1 ${!type ? "border-accent bg-accent-soft text-accent" : "border-line"}`}>All</Link>
          {EVENT_TYPES.map((t) => (
            <Link key={t} href={`/timeline?type=${t}`} className={`rounded-full border px-3 py-1 ${type === t ? "border-accent bg-accent-soft text-accent" : "border-line"}`}>
              {t.replace(/_/g, " ")}
            </Link>
          ))}
          <Link href={`/timeline?${type ? `type=${type}&` : ""}retracted=${showRetracted ? "0" : "1"}`} className="ml-auto text-muted underline">
            {showRetracted ? "Hide retracted" : "Show retracted"}
          </Link>
        </nav>
        {events.length === 0 ? (
          <EmptyState title="No announcements recorded">
            Read Danube&apos;s news page or reputable coverage in your browser and record each item with the form. This app does not fetch danubeproperties.com automatically: its Terms &amp; Conditions (Section 5) prohibit automated access.
          </EmptyState>
        ) : (
          <ol className="relative space-y-4 border-l border-line pl-5">
            {events.map((e) => (
              <li key={String(e._id)} className="relative">
                <span aria-hidden className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-accent" />
                <div className={`rounded-lg border border-line bg-surface p-3 ${e.retractedAt ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{e.publicationDate ? `Published ${fmtDate(e.publicationDate)}` : "Publication date not recorded"}</span>
                    {e.eventDate ? <span>· Event {fmtDate(e.eventDate)}</span> : null}
                    <span>· {e.eventType.replace(/_/g, " ")}</span>
                    <ClaimBadge type={e.claimType} />
                  </div>
                  <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block font-medium hover:underline">{e.title}</a>
                  <p className="mt-1 text-sm text-ink-2">{e.summary}</p>
                  <p className="mt-1 text-xs text-muted">
                    {e.publisher} · recorded {fmtDateTime(e.retrievedAt)}
                    {e.projectNames.length ? ` · Projects: ${e.projectNames.join(", ")}` : ""}
                  </p>
                  {e.retractedAt ? (
                    <Notice tone="warn">Retracted {fmtDate(e.retractedAt)}: {e.retractionReason}</Notice>
                  ) : (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted">Retract</summary>
                      <ActionForm action={retractEventAction} submitLabel="Retract (kept for history)">
                        <input type="hidden" name="id" value={String(e._id)} />
                        <input name="reason" required minLength={5} maxLength={500} placeholder="Reason" className={`${input} mt-1 w-full`} />
                      </ActionForm>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Card title="Record an announcement" subtitle="Write the summary in your own words; do not paste article text. Link to the original.">
        <ActionForm action={createEventAction} submitLabel="Save announcement" primary>
          <div className="grid gap-2 text-xs text-ink-2">
            <label>Title<input name="title" required minLength={5} maxLength={300} className={`${input} mt-1 w-full`} /></label>
            <label>
              Source URL
              <input name="url" type="url" required maxLength={2000} placeholder="https://" className={`${input} mt-1 w-full`} />
            </label>
            <label>Publisher<input name="publisher" required maxLength={200} placeholder="e.g. Danube Properties, Gulf News" className={`${input} mt-1 w-full`} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label>Publication date<input name="publicationDate" type="date" className={`${input} mt-1 w-full`} /></label>
              <label>Event date (if different)<input name="eventDate" type="date" className={`${input} mt-1 w-full`} /></label>
            </div>
            <label>
              Type
              <select name="eventType" required className={`${input} mt-1 w-full`}>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <label>
              Claim classification
              <select name="claimType" required className={`${input} mt-1 w-full`}>
                {CLAIM_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label>
              Projects (optional)
              <select name="projectIds" multiple size={Math.min(6, Math.max(2, projects.length))} className="mt-1 w-full rounded-md border border-line bg-surface p-1 text-sm">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>
              Summary (own words)
              <textarea name="summary" required minLength={10} maxLength={2000} rows={4} className="mt-1 w-full rounded-md border border-line bg-surface p-2 text-sm" />
            </label>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
