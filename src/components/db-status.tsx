import { OctagonAlert } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { getDbStatus } from "@/server/db";

/** Shown on every page when MongoDB is unreachable or misconfigured. */
export async function DbStatusBanner() {
  await connection();
  const status = await getDbStatus();
  if (status.ok) return null;
  return (
    <div role="alert" className="flex items-start gap-2.5 border-b border-crit/40 bg-crit-soft px-4 py-3 text-sm md:px-8">
      <OctagonAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-crit" />
      <p className="text-ink-2">
        <strong className="font-semibold text-ink">Database unavailable.</strong> {status.reason} Pages show no data until MongoDB is reachable —{" "}
        <Link href="/system" className="underline">
          System Health
        </Link>
        .
      </p>
    </div>
  );
}
