"use client";

import { CheckCircle2, FileSpreadsheet, OctagonAlert, Upload } from "lucide-react";
import { useActionState, useState } from "react";
import { uploadDldAction } from "@/app/actions";
import { parseCsvPreview } from "@/lib/csv";
import { detectDldKind, mapProjectRow, mapTransactionRow, missingColumns, toRow, type DldKind } from "@/server/ingest/dld-csv";
import { btnPrimary } from "./styles";

interface Preview {
  name: string;
  size: number;
  kind: DldKind | null;
  headers: string[];
  missing: string[];
  rows: Array<{ cells: string[]; ok: boolean; reasons: string[] }>;
  binary: boolean;
}

const PREVIEW_BYTES = 64 * 1024;

/** Upload one DLD export, after previewing its detected type, required columns and first rows. */
export function DldUpload({ maxMb }: { maxMb: number }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, action, pending] = useActionState(uploadDldAction, null);

  async function onFile(file: File | undefined) {
    if (!file) return setPreview(null);
    const head = new Uint8Array(await file.slice(0, Math.min(file.size, PREVIEW_BYTES)).arrayBuffer());
    const binary = head.subarray(0, 4096).includes(0);
    const text = new TextDecoder("utf-8").decode(head);
    const records = binary ? [] : parseCsvPreview(text, 7, file.size > PREVIEW_BYTES);
    const headers = records[0] ?? [];
    const kind = detectDldKind(headers);
    const rows = records.slice(1).map((cells) => {
      if (!kind) return { cells, ok: false, reasons: ["unknown export type"] };
      const mapped = kind === "transactions" ? mapTransactionRow(toRow(headers, cells)) : mapProjectRow(toRow(headers, cells));
      return { cells, ok: mapped.ok, reasons: mapped.ok ? mapped.warnings : mapped.reasons };
    });
    setPreview({ name: file.name, size: file.size, kind, headers, missing: kind ? missingColumns(headers, kind) : [], rows, binary });
  }

  const tooBig = preview ? preview.size > maxMb * 1024 * 1024 : false;
  const blocked = !preview || preview.binary || !preview.kind || tooBig || !/\.csv$/i.test(preview.name);

  return (
    <form action={action} className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-surface-2 px-4 py-5 text-center text-sm text-ink-2 hover:border-link">
        <Upload aria-hidden className="size-5 text-muted" />
        <span>
          <span className="text-link">Choose a DLD CSV export</span> to preview it (max {maxMb} MB)
        </span>
        <input type="file" name="file" accept=".csv,text/csv" required className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>

      {preview ? (
        <div className="space-y-2 rounded-lg border border-line p-3 text-xs">
          <p className="flex flex-wrap items-center gap-2 text-ink">
            <FileSpreadsheet aria-hidden className="size-4 text-muted" />
            <span className="font-medium">{preview.name}</span>
            <span className="text-muted">{(preview.size / 1024 / 1024).toFixed(2)} MB</span>
          </p>
          {preview.binary ? (
            <Problem>This is not a text CSV file.</Problem>
          ) : !preview.kind ? (
            <Problem>Not recognised as a DLD Transactions or Projects export. Required columns: Transaction Number, Transaction Date, Amount, Transaction Type — or Project Number, Project Name, Developer Name.</Problem>
          ) : (
            <p className="flex items-center gap-1.5 text-good">
              <CheckCircle2 aria-hidden className="size-4" /> Detected: DLD {preview.kind} export · {preview.headers.length} columns
            </p>
          )}
          {tooBig ? <Problem>The file is larger than {maxMb} MB. Use the data/incoming/dld folder import instead.</Problem> : null}
          {preview.rows.length ? (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full">
                <caption className="mb-1 text-left text-muted">First {preview.rows.length} rows, checked with the importer&apos;s own rules</caption>
                <thead>
                  <tr>
                    <th className="px-1.5 py-1 text-left font-medium text-muted">Check</th>
                    {preview.headers.slice(0, 6).map((h) => (
                      <th key={h} className="whitespace-nowrap px-1.5 py-1 text-left font-medium text-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className={`whitespace-nowrap px-1.5 py-1 ${r.ok ? "text-good" : "text-crit"}`} title={r.reasons.join(", ")}>
                        {r.ok ? "✓ ok" : `✕ ${r.reasons[0]?.replace(/_/g, " ")}`}
                      </td>
                      {r.cells.slice(0, 6).map((c, j) => (
                        <td key={j} className="max-w-40 truncate px-1.5 py-1 text-ink-2">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={blocked || pending} className={btnPrimary}>
          {pending ? "Uploading and importing…" : "Upload and import"}
        </button>
        {state ? (
          <p role="status" className={`text-sm ${state.ok ? "text-good" : "text-crit"}`}>
            {state.message}
          </p>
        ) : null}
      </div>
      {state?.details?.length ? (
        <ul className="space-y-1 text-xs text-ink-2">
          {state.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-[11px] text-muted">The original file is stored unchanged in data/incoming/dld with a timestamped name. Re-importing identical rows creates nothing; conflicting rows are flagged, never overwritten.</p>
    </form>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-crit">
      <OctagonAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {children}
    </p>
  );
}
