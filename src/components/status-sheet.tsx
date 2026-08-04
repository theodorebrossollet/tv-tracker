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
  /**
   * `menu` is the "..." in a library row. `pill` is the show page's header
   * control, which replaces the old Watching/Pause/Stop button trio and is the
   * only place status is set there — it appears twice on that page, in the
   * header and at the foot of About, and both read the same value.
   */
  variant?: "menu" | "pill";
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

/**
 * How the pill carries each state.
 *
 * Only the three "you're engaged with this" states take the accent. Colouring
 * paused and stopped too would turn a status into a traffic light — the same
 * reasoning `StatusBadge` documents for search results.
 */
type PillTone = "accent" | "neutral" | "quiet";

const PILL_TONE: Record<PillTone, string> = {
  accent: "border-accent-border bg-accent-tint text-accent-deep",
  neutral: "border-border bg-surface text-foreground",
  quiet: "border-border bg-transparent text-faint",
};

function toneOf(status: TrackStatus | null, finished: boolean): PillTone {
  if (status === null) return "quiet";
  if (finished || status === "watching" || status === "watchlist") {
    return "accent";
  }
  return "neutral";
}

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
  variant = "menu",
}: StatusMenuProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const targets = statusTargets(status);
  const current = currentRow(status, finished);
  const statusIcon: StatusTarget = finished
    ? "watching"
    : (status ?? "remove");

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
      {variant === "pill" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Change status for ${name}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`inline-flex min-h-9 shrink-0 items-center gap-[7px] rounded-full border px-3 text-[12.5px] font-medium ${PILL_TONE[toneOf(status, finished)]}`}
        >
          <StatusIcon status={statusIcon} className="size-[11px]" />
          {current.label}
          <ChevronDown />
        </button>
      ) : (
        /* 44px of hit area around a 32px control, per the handoff's note about
           padding small targets out in code rather than drawing them bigger. */
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
      )}

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
            <Row {...current} icon={statusIcon} checked />

            {targets.map((target) => (
              <Row
                key={target}
                {...ROWS[target]}
                icon={target}
                disabled={pending}
                onSelect={() => apply(target)}
              />
            ))}

            {status !== null ? (
              <>
                <hr className="my-1.5 border-border-faint" />
                <Row
                  {...ROWS.remove}
                  icon="remove"
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
  icon: StatusTarget;
  checked?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

function Row({ label, hint, icon, checked, disabled, onSelect }: RowProps) {
  const body = (
    <>
      {/* `surface-sunken` is *darker* than the sheet's own `surface`, so tiles
          drawn on it read as holes punched in the row rather than as tiles —
          and the icon inside all but disappeared. Raised and outlined instead,
          and the current one goes solid rather than tinted: the row behind it
          already carries the tint, and tint-on-tint left the tile invisible
          exactly where it matters most. */}
      <span
        className={`flex size-[34px] shrink-0 items-center justify-center rounded-[11px] border ${
          checked
            ? "border-transparent bg-accent text-on-accent"
            : "border-border bg-surface-raised text-muted"
        }`}
      >
        <StatusIcon status={icon} className="size-[15px]" />
      </span>
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
      className="flex min-h-14 items-center gap-3 rounded-[13px] px-2 py-2 text-left transition-colors hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
    >
      {body}
    </button>
  );
}

/** One glyph per status, shared by the pill and the sheet rows it opens. */
export function StatusIcon({
  status,
  className = "",
}: {
  status: StatusTarget;
  className?: string;
}) {
  const stroke = status === "watching" ? "3" : "2.4";

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {status === "watching" ? <path d="m5 13 4 4L19 7" /> : null}
      {status === "watchlist" ? (
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      ) : null}
      {status === "paused" ? (
        <>
          <path d="M8 5v14" />
          <path d="M16 5v14" />
        </>
      ) : null}
      {status === "stopped" ? (
        <>
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
          <path d="M10 12h4" />
        </>
      ) : null}
      {status === "remove" ? (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      ) : null}
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3 opacity-75"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
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
