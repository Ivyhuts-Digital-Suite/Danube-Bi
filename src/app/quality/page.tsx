import { CalendarX2, FileWarning, GitMerge, Landmark, ListChecks, ScanText, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { resolveIssueAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { ScopeBar } from "@/components/scope";
import { Badge, DataError, EmptyState, input, link, loadDb, Notice, PageHeader, Pagination, Panel, SeverityPill, Skeleton, StatusPill, td, tdNum, th } from "@/components/ui";
import { Meter } from "@/components/viz";
import { fmtAEDCompact, fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import { flatParams, href } from "@/lib/url";
import { rejectionInfo } from "@/server/queries/analytics";
import { getQualityWorkspace, QUEUES, type Queue } from "@/server/queries/quality-queues";

export const metadata: Metadata = { title: "Data Quality" };

export default function QualityPage(props: PageProps<"/quality">) {
  return (
    <>
      <PageHeader
        eyebrow="Data management"
        title="Data Quality"
        description="Review queues for everything that limits the analysis: incomplete records, rejected PDF lines, possible aliases, undated snapshots, unmatched DLD names and extraction failures. Original records are never changed to make a warning disappear; reviews are recorded with a note."
      />
      <Suspense fallback={<Skeleton rows={3} />}>
        <Quality searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const QUEUE_META: Record<Exclude<Queue, "overview">, { label: string; icon: typeof ListChecks; help: string }> = {
  review: { label: "Records needing review", icon: TriangleAlert, help: "Accepted records with missing or unreadable values, or an unrecognized status." },
  rejected: { label: "Rejected & unplaced lines", icon: FileWarning, help: "PDF lines that could not become unit records." },
  aliases: { label: "Possible aliases", icon: GitMerge, help: "Project names that may be the same project." },
  snapshots: { label: "Snapshot dates", icon: CalendarX2, help: "Inventory documents without a printed date." },
  dld: { label: "DLD matching", icon: Landmark, help: "Unmatched DLD project names and conflicting transactions." },
  extraction: { label: "Extraction failures", icon: ScanText, help: "Pages without a text layer and failed or interrupted runs." },
  issues: { label: "All issues", icon: ListChecks, help: "Every recorded data-quality issue, with review notes." },
};

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
  const sp = flatParams(await searchParams);
  const queue: Queue = (QUEUES as readonly string[]).includes(sp.queue ?? "") ? (sp.queue as Queue) : "overview";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const reason = sp.reason?.slice(0, 80);
  const rule = sp.rule?.slice(0, 80);
  const showResolved = sp.resolved === "1";
  const r = await loadDb(() => getQualityWorkspace(queue, { page, reason, rule, showResolved }));
  if (!r.ok) return <DataError error={r.error} />;
  const d = r.data;
  const a = d.analytics;
  const scope = d.scope.current;

  return (
    <div className="space-y-5">
      <ScopeBar scope={d.scope} path="/quality" params={{ queue }} />
      <nav aria-label="Review queues" className="scroll-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {(["overview", ...Object.keys(QUEUE_META)] as Queue[]).map((q) => {
          const active = q === queue;
          const count = q === "overview" ? null : d.counts[q as keyof typeof d.counts];
          return (
            <Link
              key={q}
              href={href("/quality", { queue: q === "overview" ? null : q })}
              aria-current={active ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${active ? "border-line-strong bg-surface-3 text-ink" : "border-transparent text-ink-2 hover:bg-surface-2"}`}
            >
              {q === "overview" ? "Overview" : QUEUE_META[q as Exclude<Queue, "overview">].label}
              {count != null ? <span className={`tabular rounded px-1 ${count ? "bg-warn-soft text-warn" : "text-muted"}`}>{fmtInt(count)}</span> : null}
            </Link>
          );
        })}
      </nav>

      {queue === "overview" ? (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(QUEUE_META) as Array<Exclude<Queue, "overview">>).map((q) => {
              const m = QUEUE_META[q];
              const Icon = m.icon;
              const n = d.counts[q];
              return (
                <Link key={q} href={href("/quality", { queue: q })} className="flex items-start gap-3 rounded-panel border border-line bg-surface p-4 shadow-panel hover:border-line-strong hover:bg-surface-2">
                  <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border ${n ? "border-warn/35 bg-warn-soft text-warn" : "border-good/30 bg-good-soft text-good"}`}>
                    {n ? <Icon aria-hidden className="size-4" /> : <ShieldCheck aria-hidden className="size-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{m.label}</span>
                    <span className="tabular block text-xl font-semibold text-ink">{fmtInt(n)}</span>
                    <span className="block text-xs text-ink-2">{m.help}</span>
                  </span>
                </Link>
              );
            })}
          </div>
          {scope ? (
            <Panel title="Field completeness" subtitle={`${fmtInt(a.records)} accepted records in ${scope.filename}`} bodyClassName="p-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Meter label="Valid listed price" value={a.coverage.withPrice} total={a.records} tone={a.coverage.withPrice / Math.max(1, a.records) < 0.9 ? "warn" : undefined} />
              <Meter label="Valid size" value={a.coverage.withArea} total={a.records} tone={a.coverage.withArea / Math.max(1, a.records) < 0.9 ? "warn" : undefined} />
              <Meter label="Price and size (AED/sq ft computable)" value={a.coverage.withPsf} total={a.records} />
              <Meter label="Status label present" value={a.coverage.withStatus} total={a.records} />
              <Meter label="Recognized status label" value={a.records - a.status.other - a.status.missing} total={a.records} />
              <Meter label="Linked to a project" value={a.coverage.withProject} total={a.records} />
              <Meter label="Typology present" value={a.coverage.withTypology} total={a.records} />
              <Meter label="Free of review-level warnings" value={a.records - a.coverage.reviewRequired} total={a.records} tone="good" />
            </Panel>
          ) : null}
        </div>
      ) : null}

      {queue === "review" ? (
        <Panel title="Records needing review, by check" subtitle="Each record keeps its original extracted text; open a check to see the affected records in the Inventory Explorer" bodyClassName="p-0">
          {a.coverage.warnings.length === 0 ? (
            <p className="p-4 text-sm text-muted">No validation notes recorded.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Check</th>
                  <th className={th}>What it means</th>
                  <th className={`${th} text-right`}>Records</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {a.coverage.warnings.map((w) => (
                  <tr key={w.code} className={w.info.review ? "" : "text-ink-2"}>
                    <td className={td}>
                      <span className="flex items-center gap-2">
                        {w.info.review ? <Badge tone="warn">Review</Badge> : <Badge>Note</Badge>}
                        <span className="text-ink">{w.info.label}</span>
                      </span>
                    </td>
                    <td className={`${td} max-w-xl text-xs text-ink-2`}>{w.info.explanation}</td>
                    <td className={tdNum}>{fmtInt(w.count)}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <Link className={link} href={href("/inventory", { warn: w.code })}>
                        View records →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ) : null}

      {queue === "rejected" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Link href={href("/quality", { queue: "rejected" })} className={`rounded-full border px-3 py-1 text-xs ${!reason ? "border-ink bg-ink text-bg" : "border-line-strong text-ink-2 hover:bg-surface-2"}`}>
              All {fmtInt(d.rejections.total)}
            </Link>
            {d.rejections.byReason.map((x) => (
              <Link
                key={x.reason}
                href={href("/quality", { queue: "rejected", reason: x.reason })}
                className={`rounded-full border px-3 py-1 text-xs ${reason === x.reason ? "border-ink bg-ink text-bg" : "border-line-strong text-ink-2 hover:bg-surface-2"}`}
              >
                {rejectionInfo(x.reason).label} {fmtInt(x.count)}
              </Link>
            ))}
          </div>
          {reason ? <Notice>{rejectionInfo(reason).explanation}</Notice> : null}
          <Panel
            title={reason ? rejectionInfo(reason).label : "Rejected and unplaced lines"}
            subtitle={scope ? `${scope.filename} · original text is kept exactly as read` : undefined}
            footer="To recover these units, fix the source document or extend the parser and re-import; accepted records are never duplicated."
            bodyClassName="p-0"
          >
            {!d.rejected || d.rejected.rows.length === 0 ? (
              <p className="p-4 text-sm text-muted">No rejected lines.</p>
            ) : (
              <>
                <div className="scroll-thin max-h-[640px] overflow-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr>
                        <th className={th}>Page · line</th>
                        <th className={th}>Outcome</th>
                        <th className={th}>Original text</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rejected.rows.map((x) => (
                        <tr key={x.locator}>
                          <td className={`${td} tabular whitespace-nowrap text-xs`}>
                            p.{x.p} · l.{x.l}
                          </td>
                          <td className={`${td} whitespace-nowrap text-xs`}>
                            {x.reasons.map((rs) => (
                              <Badge key={rs} tone={rejectionInfo(rs).kind === "unplaced" ? "neutral" : "crit"} title={rejectionInfo(rs).explanation}>
                                {rejectionInfo(rs).label}
                              </Badge>
                            ))}
                          </td>
                          <td className={`${td} text-xs`}>
                            <span className="break-all font-mono text-ink-2">{String(x.raw?._line ?? "")}</span>
                            {x.raw && Object.keys(x.raw).some((k) => k !== "_line") ? (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-link">Columns as read</summary>
                                <dl className="mt-1 grid grid-cols-[7rem_1fr] gap-x-2 text-[11px]">
                                  {Object.entries(x.raw)
                                    .filter(([k]) => k !== "_line")
                                    .map(([k, v]) => (
                                      <div key={k} className="contents">
                                        <dt className="text-muted">{k}</dt>
                                        <dd className="font-mono text-ink-2">{String(v)}</dd>
                                      </div>
                                    ))}
                                </dl>
                              </details>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-3">
                  <Pagination page={page} pageCount={Math.max(1, Math.ceil(d.rejected.total / d.pageSize))} total={d.rejected.total} pageSize={d.pageSize} href={(p) => href("/quality", { queue: "rejected", reason, page: p })} />
                </div>
              </>
            )}
          </Panel>
        </div>
      ) : null}

      {queue === "aliases" ? (
        d.aliases.length === 0 ? (
          <EmptyState icon={GitMerge} title="No open alias questions" />
        ) : (
          <Panel title="Possible project aliases" subtitle="Similar names are kept as separate projects until a person decides. Compare their sources; merge on a project page only when the evidence supports it, or mark the pair reviewed." bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {d.aliases.map((x) => (
                <li key={x.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {x.projects.map((p, i) => (
                        <span key={p.id} className="flex items-center gap-2">
                          {i > 0 ? <span className="text-muted">↔</span> : null}
                          <Link className={link} href={`/projects/${p.id}`}>
                            {p.name}
                          </Link>
                          <span className="tabular text-xs text-muted">({fmtInt(p.records)} records)</span>
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-ink-2">{x.details}</p>
                    <p className="mt-0.5 text-[11px] text-muted">Detected {fmtDateTime(x.detectedAt)}</p>
                  </div>
                  <ActionForm action={resolveIssueAction} submitLabel="Mark reviewed — keep separate">
                    <input type="hidden" name="id" value={x.id} />
                    <label className="sr-only" htmlFor={`note-${x.id}`}>
                      Review note
                    </label>
                    <input id={`note-${x.id}`} name="note" required minLength={5} maxLength={500} placeholder="What you checked and concluded" className={`${input} w-full`} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          </Panel>
        )
      ) : null}

      {queue === "snapshots" ? (
        <Panel title="Inventory snapshot dates" subtitle="A snapshot date is taken only from a date printed in the document. File and import dates are never used instead." bodyClassName="p-0">
          {d.scope.snapshots.length === 0 ? (
            <p className="p-4 text-sm text-muted">No inventory snapshots imported.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Document</th>
                  <th className={th}>Snapshot date</th>
                  <th className={th}>Evidence</th>
                  <th className={th}>Imported (not a snapshot date)</th>
                  <th className={`${th} text-right`}>Records</th>
                </tr>
              </thead>
              <tbody>
                {d.scope.snapshots.map((s) => (
                  <tr key={s.id}>
                    <td className={td}>{s.filename}</td>
                    <td className={td}>{s.dateKnown ? fmtDate(s.snapshotDate) : <Badge tone="warn">Unknown</Badge>}</td>
                    <td className={`${td} text-xs text-ink-2`}>
                      {s.dateKnown ? `“${s.dateEvidence}”` : "No “as of / updated on” date found on the first pages. Statuses and prices cannot be placed in time; time comparisons are disabled for this document."}
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs text-muted`}>{fmtDateTime(s.importedAt)}</td>
                    <td className={tdNum}>{fmtInt(s.recordCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ) : null}

      {queue === "dld" ? (
        <div className="space-y-4">
          {d.unmatched.length === 0 && d.counts.dld === 0 ? (
            <EmptyState icon={Landmark} title="Nothing to match">
              No DLD transactions are imported, or every imported transaction is already matched.{" "}
              <Link className={link} href="/sources#dld">
                Import DLD exports
              </Link>
              .
            </EmptyState>
          ) : (
            <Panel title="DLD project names not linked to any project" subtitle="These transactions are never attributed here. Add an alias on the right project page only after checking the evidence." bodyClassName="p-0">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>DLD project name</th>
                    <th className={th}>Developer (register)</th>
                    <th className={`${th} text-right`}>Transactions</th>
                    <th className={`${th} text-right`}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {d.unmatched.map((u) => (
                    <tr key={u._id}>
                      <td className={td}>{u._id}</td>
                      <td className={`${td} text-ink-2`}>{u.developerName ?? "unattributed"}</td>
                      <td className={tdNum}>{fmtInt(u.n)}</td>
                      <td className={tdNum}>{fmtAEDCompact(u.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      ) : null}

      {queue === "extraction" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Document extraction" subtitle="Pages without a text layer were not read (OCR is not supported)" bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {d.docs.map((doc) => (
                <li key={String(doc._id)} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ink">{doc.filename}</span>
                    <StatusPill status={doc.extractionStatus} />
                  </div>
                  {doc.warnings.length ? (
                    <ul className="mt-1.5 space-y-1 text-xs text-ink-2">
                      {doc.warnings.map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-muted">No extraction warnings.</p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Failed or interrupted runs" bodyClassName="p-0">
            {d.failedRuns.length === 0 ? (
              <p className="p-4 text-sm text-muted">None.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.failedRuns.map((run) => (
                  <li key={String(run._id)} className="px-4 py-2.5 text-sm">
                    <Link className={link} href={`/sources/runs/${run._id}`}>
                      {fmtDateTime(run.startedAt)} · {run.sourceKey}
                    </Link>
                    <p className="text-xs text-crit">{run.errors[0] ?? run.status}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}

      {queue === "issues" && d.issues ? (
        <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <Panel title="By rule" bodyClassName="p-2">
            <ul className="space-y-0.5">
              <li>
                <Link href={href("/quality", { queue: "issues", resolved: showResolved ? "1" : null })} className={`block rounded-md px-2 py-1.5 text-xs ${!rule ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2"}`}>
                  All rules
                </Link>
              </li>
              {d.openByRule.map((b) => (
                <li key={`${b._id.rule}-${b._id.severity}`}>
                  <Link
                    href={href("/quality", { queue: "issues", rule: b._id.rule, resolved: showResolved ? "1" : null })}
                    className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs ${rule === b._id.rule ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2"}`}
                    title={RULE_HELP[b._id.rule]}
                  >
                    <span className="truncate">{b._id.rule.replace(/_/g, " ")}</span>
                    <span className="tabular">{fmtInt(b.n)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel
            title={`${showResolved ? "All" : "Open"} issues${rule ? ` · ${rule.replace(/_/g, " ")}` : ""} (${fmtInt(d.issues.total)})`}
            subtitle={rule ? RULE_HELP[rule] : d.issues.total > d.issues.list.length ? `Showing the first ${d.issues.list.length}` : undefined}
            actions={
              <Link className={link} href={href("/quality", { queue: "issues", rule, resolved: showResolved ? null : "1" })}>
                {showResolved ? "Hide reviewed" : "Include reviewed"}
              </Link>
            }
            bodyClassName="p-0"
          >
            {d.issues.list.length === 0 ? (
              <p className="p-4 text-sm text-muted">Nothing to show.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.issues.list.map((i) => (
                  <li key={String(i._id)} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <SeverityPill severity={i.severity} />
                      <span className="font-medium text-ink">{i.rule.replace(/_/g, " ")}</span>
                      <span className="text-muted">first seen {fmtDateTime(i.detectedAt)} · last seen {fmtDateTime(i.lastSeenAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-2">{i.details}</p>
                    {i.resolvedAt ? (
                      <p className="mt-1 text-xs text-good">
                        Reviewed {fmtDateTime(i.resolvedAt)}: {i.resolutionNote}
                      </p>
                    ) : (
                      <details className="mt-1.5 text-xs">
                        <summary className="cursor-pointer text-link">Record a review decision</summary>
                        <ActionForm action={resolveIssueAction} submitLabel="Save review note">
                          <input type="hidden" name="id" value={String(i._id)} />
                          <input name="note" required minLength={5} maxLength={500} placeholder="What you checked and concluded" aria-label="Review note" className={`${input} mt-1.5 w-full`} />
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
