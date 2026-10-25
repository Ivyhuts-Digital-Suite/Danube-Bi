"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-crit/40 bg-crit-soft p-6 text-sm">
      <p className="font-semibold">This page failed to load.</p>
      <p className="mt-1 text-ink-2">The details were written to the server log. Check that MongoDB is running, then try again.</p>
      <button type="button" onClick={reset} className="mt-3 rounded-md border border-line bg-surface px-3 py-1.5 font-medium">
        Try again
      </button>
    </div>
  );
}
