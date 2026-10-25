import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { DataError, EmptyState, loadDb, PageHeader, Skeleton, input, btn, td, tdNum, th } from "@/components/ui";
import { fmtInt } from "@/lib/format";
import { listProjects } from "@/server/queries/catalog";

export const metadata: Metadata = { title: "Project Portfolio" };

export default function ProjectsPage(props: PageProps<"/projects">) {
  return (
    <>
      <PageHeader
        title="Project Portfolio"
        description="Projects named in the imported documents. Names are merged only on an exact match; similar names are listed separately until a person reviews them."
      />
      <Suspense fallback={<Skeleton />}>
        <ProjectList searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function ProjectList({ searchParams }: { searchParams: PageProps<"/projects">["searchParams"] }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const r = await loadDb(() => listProjects(q || undefined));
  if (!r.ok) return <DataError error={r.error} />;
  const projects = r.data;
  return (
    <div className="space-y-4">
      <Form action="/projects" className="flex gap-2">
        <label htmlFor="project-q" className="sr-only">Filter projects</label>
        <input id="project-q" name="q" defaultValue={q} placeholder="Filter by name or alias" maxLength={100} className={`${input} w-72`} />
        <button className={btn} type="submit">Filter</button>
      </Form>
      {projects.length === 0 ? (
        <EmptyState title={q ? "No project matches this filter" : "No projects yet"}>
          {q ? "Try another name." : "Projects are created when Merge1.pdf, Merge2.pdf or DLD exports are imported (Sources & Imports)."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Project</th>
                <th className={th}>Aliases</th>
                <th className={th}>Found in</th>
                <th className={`${th} text-right`}>Inventory rows</th>
                <th className={`${th} text-right`}>Brochure pages</th>
                <th className={`${th} text-right`}>Brochure claims</th>
                <th className={`${th} text-right`}>Linked DLD transactions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2">
                  <td className={td}>
                    <Link href={`/projects/${p.id}`} className="font-medium text-accent hover:underline">{p.name}</Link>
                  </td>
                  <td className={`${td} text-ink-2`}>{p.aliases.join(", ") || "—"}</td>
                  <td className={`${td} text-ink-2`}>{p.sourceTypes.join(", ").replace(/_/g, " ") || "—"}</td>
                  <td className={tdNum}>{fmtInt(p.inventoryRows)}</td>
                  <td className={tdNum}>{fmtInt(p.brochurePages)}</td>
                  <td className={tdNum}>{fmtInt(p.facts)}</td>
                  <td className={tdNum}>{fmtInt(p.transactions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
