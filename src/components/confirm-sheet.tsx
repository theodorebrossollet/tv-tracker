"use client";

import { Sheet } from "@/components/sheet";

interface ConfirmSheetProps {
  /** The question, as the sheet's title: "Delete this list?". */
  title: string;
  /** What will happen, in a sentence or two. */
  children: React.ReactNode;
  /** The confirming button's label: the verb, not "OK". */
  confirmLabel: string;
  /** Red confirm button, for something that deletes or can't be undone. */
  danger?: boolean;
  /** Set while the action runs; locks both buttons. */
  pending: boolean;
  /** The action's error, shown inside the sheet (see `lib/notify.ts` for why
      this is not a toast). */
  error: string | null;
  onConfirm: () => void;
  /** The Cancel button. */
  onCancel: () => void;
  /**
   * Leaving the sheet any other way: Escape, a tap outside, the grab handle.
   * Separate from `onCancel` because in a two-step sheet Cancel goes back to
   * the menu while dismissing closes the whole thing. Defaults to `onCancel`.
   */
  onClose?: () => void;
}

/**
 * The second step before something that deserves one: a question, what it
 * will do, Cancel and the verb.
 *
 * It existed five times, once per caller, each a copy of the last, so a
 * restyle had to be made five times and was once made in four. A confirmation
 * rather than `window.confirm`, which some embedded webviews block and which
 * can be neither styled nor tested.
 *
 * Presentation only. The caller owns the transition, the error and what
 * "cancel" means, because those differ: some go back a step, some close.
 */
export function ConfirmSheet({
  title,
  children,
  confirmLabel,
  danger = false,
  pending,
  error,
  onConfirm,
  onCancel,
  onClose = onCancel,
}: ConfirmSheetProps) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="px-1.5 text-[13px] leading-relaxed text-muted">{children}</p>

      {error ? (
        <p role="alert" className="mt-2 px-1.5 text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-3.5 flex gap-2 px-1.5 pb-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          // Filled, like every other button: a tint rather than `surface`,
          // because the panel is `surface-raised` and the darker step would
          // read as a hole in it.
          className="min-h-[46px] flex-1 rounded-full bg-accent-tint px-[22px] text-[15px] font-medium disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={`min-h-[46px] flex-1 rounded-full px-[22px] text-[15px] font-semibold text-on-accent disabled:opacity-50 ${
            danger ? "bg-danger" : "bg-accent"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
