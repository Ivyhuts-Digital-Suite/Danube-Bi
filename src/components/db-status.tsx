import { connection } from "next/server";
import { getDbStatus } from "@/server/db";

/** Shown on every page when MongoDB is unreachable or misconfigured. */
export async function DbStatusBanner() {
  await connection();
  const status = await getDbStatus();
  if (status.ok) return null;
  return (
    <div role="alert" className="border-b border-crit/40 bg-crit-soft px-4 py-3 text-sm md:px-8">
      <strong className="font-semibold">Database unavailable.</strong> {status.reason} Pages show no data until MongoDB is reachable — see README › MongoDB setup.
    </div>
  );
}
