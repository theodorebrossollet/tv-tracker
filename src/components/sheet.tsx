"use client";

import { useEffect, useRef } from "react";

interface SheetProps {
  /** Names the dialog for assistive tech, and heads the panel. */
  title: string;
  /** Optional line under the title, for a rule the rows can't state. */
  caption?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * A bottom sheet, built on the native `<dialog>` element.
 *
 * `showModal()` is what makes this cheap: the focus trap, the initial focus,
 * Escape-to-close and the inertness of everything behind it are the browser's
 * job rather than a pile of effects that has to be right in three components.
 * The search overlay predates this and hand-rolls a subset (Escape and a scroll
 * lock, no trap) — worth moving over the next time it is touched.
 *
 * Body scroll is still locked by hand. A modal dialog makes the page inert but
 * does not reliably stop it scrolling underneath on iOS, which reads as the
 * sheet dragging the page around with it.
 */
export function Sheet({ title, caption, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // Rendered closed and opened here rather than with the `open` attribute:
    // only `showModal()` produces a *modal* dialog, and `open` alone gives a
    // non-modal one with no trap and no backdrop.
    dialog.showModal();

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      // Escape fires `cancel`, which would close the dialog without telling the
      // parent — leaving the state that renders it still true, so it could
      // never be reopened.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // The dialog fills the viewport and carries the scrim itself, so a click
      // landing on it rather than on the panel inside is a click outside.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="m-0 h-full max-h-full w-full max-w-full bg-neutral-900/40 p-0 backdrop-blur-[2px] animate-[scrim-in_.18s_ease-out] motion-reduce:animate-none dark:bg-black/60"
    >
      <div className="flex h-full flex-col justify-end">
        <div className="rounded-t-[22px] border-t border-border bg-surface px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-12px_30px_-18px_rgba(0,0,0,.35)] animate-[sheet-up_.26s_cubic-bezier(.32,.72,0,1)] motion-reduce:animate-none">
          <div className="flex justify-center pb-2.5">
            <span
              aria-hidden="true"
              className="h-1 w-[38px] rounded-full bg-icon-faint"
            />
          </div>

          <p className="px-1.5 text-[13px] font-semibold tracking-[-0.01em]">
            {title}
          </p>
          {caption ? (
            <p className="mt-1 px-1.5 text-[11.5px] leading-relaxed text-muted">
              {caption}
            </p>
          ) : null}

          <div className="mt-2.5">{children}</div>
        </div>
      </div>
    </dialog>
  );
}
