import { connection } from "next/server";
import { getDbStatus } from "@/server/db";

/** Local health check: database reachability only. Never returns connection details. */
export async function GET() {
  await connection();
  const db = await getDbStatus();
  return Response.json({ ok: db.ok, database: db.ok ? "reachable" : "unreachable", ...(db.ok ? {} : { reason: db.reason }) }, { status: db.ok ? 200 : 503 });
}
