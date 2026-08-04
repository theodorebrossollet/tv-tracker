"use client";

import { useState, useTransition } from "react";

import { Sheet } from "@/components/sheet";
import { STATUS_ACTIONS } from "@/components/status-actions";
import {
  explainsPromotion,
  statusTargets,
  type StatusTarget,
} from "@/lib/status-transitions";
import type { TrackStatus } from "@/lib/types";

interface StatusMenuProps {
  showId: string;
  name: string;
  status: TrackStatus | null;
  /**
   * Every aired episode watched. Derived by `getShowBuckets`, never stored, so
   * it has to be passed in — the show's stored status is still "watching".
   */
  finished?: boolean;
}

const ROWS: Record<StatusTarget, { label: string; hint: string }> = {
  watching: {
    label: "Watching",
    // Not "shows up on your dashboard": a fully-watched show is stored as
    // "watching" but buckets as finished, so it sits in the Archive instead.
    hint: "In progress",
  },
  watchlist: { label: "Watchlist", hint: "Saved for later" },
  paused: { label: "Paused", hint: "Hidden from the dashboard" },
  stopped: { label: "Stopped", hint: "Moved to your archive" },
  remove: { label: "Not tracked", hint: "Not in your library" },
};

/** What the checked row reads, which is not always the stored status. */
function currentRow(status: TrackStatus | null, finished: boolean) {
  if (finished) {
    return { label: "Finished", hint: "Every aired episode watched" };
  }

  return status ? ROWS[status] : ROWS.remove;
}

/**
 * The per-row "..." control and the status sheet it opens.
 *
 * Replaces `AddButton variant="icon"` in the library lists: that button could
 * only add or remove, so pausing or stopping a show meant opening it first.
 */
export function StatusMenu({
  showId,
  name,
  status,
  finished = false,
}: StatusMenuProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const targets = statusTargets(status);
  const current = currentRow(status, finished);

  function apply(target: StatusTarget) {
    setError(null);

    startTransition(async () => {
      // Each target maps to the one action whose guard already accepts this
      // transition — see lib/status-transitions.ts for why the set is narrow.
      const result = await STATUS_ACTIONS[target](showId);

      // Kept open on failure: closing would drop the only place the message
      // has to appear, and the row underneath still shows the old status with
      // no hint that anything went wrong.
      if (result.ok) setOpen(false);
      else setError(result.error ?? "Something went wrong. Please try again.");
    });
  }

  return (
    <>
      {/* 44px of hit area around a 32px control, per the handoff's note about
          padding small targets out in code rather than drawing them bigger. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Change status for ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative -m-1.5 flex size-11 shrink-0 items-center justify-center"
      >
        <span className="flex size-8 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface hover:text-foreground">
          <EllipsisIcon />
        </span>
      </button>

      {open ? (
        <Sheet
          title={`Track ${name} as`}
          caption={
            explainsPromotion(status)
              ? "A show moves to Watching when you mark an episode watched."
              : undefined
          }
          onClose={() => setOpen(false)}
        >
          <div className="flex flex-col gap-0.5">
            <Row {...current} checked />

            {targets.map((target) => (
              <Row
                key={target}
                {...ROWS[target]}
                disabled={pending}
                onSelect={() => apply(target)}
              />
            ))}

            {status !== null ? (
              <>
                <hr className="my-1.5 border-border-faint" />
                <Row
                  {...ROWS.remove}
                  disabled={pending}
                  onSelect={() => apply("remove")}
                />
              </>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="mt-2 px-1.5 text-xs text-danger">
              {error}
            </p>
          ) : null}
        </Sheet>
      ) : null}
    </>
  );
}

interface RowProps {
  label: string;
  hint: string;
  checked?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

function Row({ label, hint, checked, disabled, onSelect }: RowProps) {
  const body = (
    <>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="mt-0.5 block text-[11.5px] text-muted">{hint}</span>
      </span>
      {checked ? <CheckIcon className="size-4 shrink-0 text-accent" /> : null}
    </>
  );

  // The current value is a statement, not a choice. Rendering it as a button
  // that re-applies the status it already has would give four of the five rows
  // a no-op twin.
  if (checked) {
    return (
      <div className="flex min-h-14 items-center gap-3 rounded-[13px] bg-accent-tint px-2 py-2">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="flex min-h-14 items-center gap-3 rounded-[13px] px-2 py-2 text-left transition-colors hover:bg-surface-sunken disabled:opacity-50"
    >
      {body}
    </button>
  );
}

function EllipsisIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-[15px]">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

export function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}
