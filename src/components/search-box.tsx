"use client";

import Form from "next/form";
import { useSearchParams } from "next/navigation";

export function SearchBox() {
  const q = useSearchParams().get("q") ?? "";
  return (
    <Form action="/search" className="w-full max-w-md" role="search">
      <label htmlFor="global-search" className="sr-only">
        Search projects, units, announcements and brochure text
      </label>
      <input
        id="global-search"
        name="q"
        defaultValue={q}
        maxLength={100}
        placeholder="Search projects, unit numbers, announcements, brochure text…"
        className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm placeholder:text-muted focus:outline-2 focus:outline-accent"
      />
    </Form>
  );
}
