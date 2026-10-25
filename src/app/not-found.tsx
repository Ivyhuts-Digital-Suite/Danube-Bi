import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-lg border border-line bg-surface p-6 text-sm">
      <p className="font-semibold">Not found</p>
      <p className="mt-1 text-ink-2">The record does not exist or was merged into another project.</p>
      <Link href="/" className="mt-3 inline-block text-accent underline">Back to the Command Center</Link>
    </div>
  );
}
