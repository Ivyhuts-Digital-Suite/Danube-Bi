"use client";

import { OctagonAlert } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex gap-3 rounded-panel border border-crit/40 bg-crit-soft p-6 text-sm">
      <OctagonAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-crit" />
      <div>
        <p className="font-semibold text-ink">This page failed to load.</p>
        <p className="mt-1 text-ink-2">The details were written to the server log. Check System Health (database reachability), then try again.</p>
        <button type="button" onClick={reset} className="mt-3 inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3 font-medium text-ink hover:bg-surface-2">
          Try again
        </button>
      </div>
    </div>
  );
}
