import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <EmptyState
        icon={SearchX}
        title="This record does not exist"
        action={
          <Link href="/" className="text-sm text-link hover:underline">
            Back to the Command Center
          </Link>
        }
      >
        It may have been merged into another project (its name is then kept as an alias there — try the search box).
      </EmptyState>
    </>
  );
}
