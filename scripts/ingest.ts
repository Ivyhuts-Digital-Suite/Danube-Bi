// CLI for repeatable imports. Usage:
//   npm run ingest -- pdf                      import data/incoming/Merge1.pdf and Merge2.pdf
//   npm run ingest -- inventory <file.pdf>     import an inventory PDF
//   npm run ingest -- brochure <file.pdf>      import a brochure PDF
//   npm run ingest -- dld [file.csv]           import one DLD CSV, or every CSV in data/incoming/dld
//   npm run ingest -- status                   show recent runs
import fs from "node:fs";
import path from "node:path";

for (const f of [".env.local", ".env"]) {
  if (fs.existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const { disconnectDb } = await import("@/server/db");
  const svc = await import("@/server/ingest/service");
  const { IngestionRun } = await import("@/server/models");
  let failed = false;
  const print = (filename: string, r: { status: string; message: string; runId: string }) => {
    console.log(`${filename}: ${r.status.toUpperCase()} — ${r.message} (run ${r.runId})`);
    if (r.status === "failed") failed = true;
  };
  try {
    switch (cmd) {
      case "pdf":
        for (const { filename, result } of await svc.importExpectedPdfs("cli")) print(filename, result);
        break;
      case "inventory":
      case "brochure":
        if (!arg) throw new Error(`Usage: npm run ingest -- ${cmd} <file.pdf>`);
        print(path.basename(arg), await svc.importPdfFile(path.resolve(arg), cmd, "cli"));
        break;
      case "dld":
        if (arg) print(path.basename(arg), await svc.importDldFile(path.resolve(arg), "cli"));
        else {
          const results = await svc.importDldFolder("cli");
          if (results.length === 0) console.log("No CSV files in data/incoming/dld.");
          for (const { filename, result } of results) print(filename, result);
        }
        break;
      case "status": {
        await svc.prepareDatabase();
        const runs = await IngestionRun.find().sort({ startedAt: -1 }).limit(20).lean();
        if (runs.length === 0) console.log("No ingestion runs yet.");
        for (const r of runs) {
          console.log(
            `${r.startedAt.toISOString()}  ${r.sourceKey.padEnd(22)} ${r.status.padEnd(22)} created=${r.recordsCreated} skipped=${r.recordsSkipped} rejected=${r.recordsRejected}  ${r.filename ?? ""}${r.errors[0] ? `  ERROR: ${r.errors[0]}` : ""}`,
          );
        }
        break;
      }
      default:
        console.log("Commands: pdf | inventory <file> | brochure <file> | dld [file] | status");
        process.exitCode = 2;
        return;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    failed = true;
  } finally {
    await disconnectDb().catch(() => undefined);
  }
  if (failed) process.exitCode = 1;
}

void main();
