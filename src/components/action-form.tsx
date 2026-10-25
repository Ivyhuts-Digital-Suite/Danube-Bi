"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/app/actions";
import { btn, btnPrimary } from "./styles";

/** A form bound to a server action, with pending state and a truthful result message. */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel = "Working…",
  children,
  primary = false,
  className = "",
  confirm,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
  primary?: boolean;
  className?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primary ? btnPrimary : btn}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {state ? (
          <p role="status" className={`text-sm ${state.ok ? "text-ink-2" : "text-crit"}`}>
            {state.message}
          </p>
        ) : null}
      </div>
      {state?.details?.length ? (
        <ul className="mt-2 space-y-1 text-xs text-ink-2">
          {state.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
