import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { resolveIssueAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Card, DataError, EmptyState, input, loadDb, PageHeader, SeverityPill, Skeleton, td, tdNum, th } from "@/components/ui";
import { fmtAEDCompact, fmtDateTime, fmtInt } from "@/lib/format";
import { UNAVAILABLE_METRICS } from "@/lib/metrics";
import { listIssues, unmatchedTransactionNames } from "@/server/queries/catalog";

export const metadata: Metadata = { title: "Data Quality" };

export default function QualityPage(props: PageProps<"/quality">) {
  return (
    <>
      <PageHeader
        title="Data Sources & Quality"
        description="Duplicates, conflicts, missing fields, unknown snapshot dates, unmatched names and possible aliases. Issues are flagged for review — data is never changed automatically to make them disappear."
      />
      <Suspense fallback={<Skeleton rows={5} />}>
        <Quality searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const RULE_HELP: Record<string, string> = {
  conflicting_unit_records: "Same unit listed more than once in one snapshot with different values",
  duplicate_unit_records: "Same unit listed more than once in one snapshot with identical values",
  missing_field: "Rows without a usable value for a field",
  snapshot_date_unknown: "Inventory document has no printed date",
  possible_project_alias: "Two project names that may be the same project",
  unmatched_project_candidate: "DLD project name that contains a known project name but is not linked",
  conflicting_transaction_record: "Same DLD transaction number with different values in a later file",
  ambiguous_developer_for_project_name: "One DLD project name used by several developers",
  same_filename_new_content: "A file was replaced with different content",
  projects_merged_by_user: "Record of a reviewed merge",
};

async function Quality({ searchParams }: { searchParams: PageProps<"/quality">["searchParams"] }) {
  const sp = await searchParams;
  const rule = typeof sp.rule === "string" ? sp.rule.slice(0, 80) : undefined;
  const severity = typeof sp.severity === "string" && ["info", "warning", "error"].includes(sp.severity) ? sp.severity : undefined;
  const showResolved = sp.resolved === "1";
  const r = await loadDb(async () => ({ list: await listIssues({ rule, severity, open: !showResolved }), unmatched: await unmatchedTransactionNames(30) }));
  if (!r.ok) return <DataError error={r.error} />;
  const { list, unmatched } = r.data;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { rule, severity, resolved: showResolved ? "1" : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/quality?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <Card title="Open issues by rule" subtitle="Select a rule to filter">
        {list.byRule.length === 0 ? (
          <EmptyState title="No open issues">Issues appear here after imports run their checks.</EmptyState>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {list.byRule.map((b) => (
              <li key={`${b._id.rule}-${b._id.severity}`}>
                <Link href={qs({ rule: b._id.rule })} className={`block rounded-md border p-3 hover:bg-surface-2 ${rule === b._id.rule ? "border-accent" : "border-line"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{b._id.rule.replace(/_/g, " ")}</span>
                    <span className="tabular text-sm">{fmtInt(b.n)}</span>
                  </div>
                  <SeverityPill severity={b._id.severity} />
                  <p className="mt-1 text-xs text-muted">{RULE_HELP[b._id.rule] ?? ""}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={`${showResolved ? "All" : "Open"} issues${rule ? ` · ${rule.replace(/_/g, " ")}` : ""} (${fmtInt(list.total)})`}
        subtitle={list.total > list.issues.length ? `Showing the first ${list.issues.length}` : undefined}
        actions={
          <div className="flex gap-3 text-xs">
            {rule || severity ? <Link className="text-accent underline" href="/quality">Clear filters</Link> : null}
            <Link className="text-accent underline" href={qs({ resolved: showResolved ? undefined : "1" })}>{showResolved ? "Hide reviewed" : "Include reviewed"}</Link>
          </div>
        }
      >
        {list.issues.length === 0 ? (
          <EmptyState title="Nothing to show" />
        ) : (
          <ul className="divide-y divide-line">
            {list.issues.map((i) => (
              <li key={String(i._id)} className="py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <SeverityPill severity={i.severity} />
                  <span className="font-medium">{i.rule.replace(/_/g, " ")}</span>
                  <span className="text-muted">last seen {fmtDateTime(i.lastSeenAt)}</span>
                  {i.resolvedAt ? <span className="text-good">reviewed: {i.resolutionNote}</span> : null}
                </div>
                <p className="mt-1 text-sm">{i.details}</p>
                {!i.resolvedAt ? (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-muted">Mark as reviewed</summary>
                    <ActionForm action={resolveIssueAction} submitLabel="Save review note">
                      <input type="hidden" name="id" value={String(i._id)} />
                      <input name="note" required minLength={5} maxLength={500} placeholder="What you checked and concluded" className={`${input} mt-1 w-full`} />
                    </ActionForm>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="DLD project names not linked to any project" subtitle="These transactions are never attributed to a project in this app. Add an alias on the right project page only after checking the evidence.">
        {unmatched.length === 0 ? (
          <EmptyState title="None" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>DLD project name</th>
                <th className={th}>Developer (from register)</th>
                <th className={`${th} text-right`}>Transactions</th>
                <th className={`${th} text-right`}>Value</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((u) => (
                <tr key={u._id}>
                  <td className={td}>{u._id}</td>
                  <td className={`${td} text-ink-2`}>{u.developerName ?? "unattributed"}</td>
                  <td className={tdNum}>{fmtInt(u.n)}</td>
                  <td className={tdNum}>{fmtAEDCompact(u.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Metrics that are unavailable" subtitle="No public source supports these; they are shown as unavailable instead of estimated">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>Metric</th>
              <th className={th}>Data that would be required</th>
            </tr>
          </thead>
          <tbody>
            {UNAVAILABLE_METRICS.map((m) => (
              <tr key={m.name}>
                <td className={td}>{m.name}</td>
                <td className={`${td} text-ink-2`}>{m.requires}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
