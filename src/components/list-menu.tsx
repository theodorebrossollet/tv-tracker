"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteList } from "@/app/list-actions";
import { ListFormSheet } from "@/components/list-form-sheet";
import { Sheet } from "@/components/sheet";

interface ListMenuProps {
  list: { id: string; name: string; trackSeparately: boolean };
}

type Step = "closed" | "menu" | "confirm" | "edit";

/**
 * The "..." beside a list's name: rename or re-configure it, or delete it.
 *
 * Deleting is a second step inside the sheet rather than `window.confirm`,
 * which is blocked in some embedded webviews and can't be styled or tested.
 * The error is plain state so it is still there once the transition settles.
 */
export function ListMenu({ list }: ListMenuProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("closed");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setStep("closed");
    setError(null);
  }

  function confirmDelete() {
    setError(null);

    startTransition(async () => {
      const result = await deleteList(list.id);

      if (!result.ok) {
        setError(result.error ?? "Something went wrong. Please try again.");
        return;
      }

      router.push("/lists");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setStep("menu")}
        aria-label="List options"
        aria-haspopup="dialog"
        className="relative -m-1.5 flex size-11 shrink-0 items-center justify-center"
      >
        <span className="flex size-8 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface hover:text-foreground">
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-[15px]">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </span>
      </button>

      {step === "menu" ? (
        <Sheet title="List options" onClose={close}>
          <div className="flex flex-col gap-0.5">
            <Option label="Edit list" onSelect={() => setStep("edit")} />
            <Option
              label="Delete list"
              danger
              onSelect={() => setStep("confirm")}
            />
          </div>
        </Sheet>
      ) : null}

      {step === "confirm" ? (
        <Sheet title="Delete this list?" onClose={close}>
          <p className="px-1.5 text-[13px] leading-relaxed text-muted">
            &ldquo;{list.name}&rdquo; will be deleted. The titles in it stay in
            your library.
          </p>

          {error ? (
            <p role="alert" className="mt-2 px-1.5 text-xs text-danger">
              {error}
            </p>
          ) : null}

          <div className="mt-3.5 flex gap-2 px-1.5 pb-1">
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="min-h-[46px] flex-1 rounded-full border border-border px-[22px] text-[15px] font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={pending}
              className="min-h-[46px] flex-1 rounded-full bg-danger px-[22px] text-[15px] font-semibold text-on-accent disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </Sheet>
      ) : null}

      {step === "edit" ? (
        <ListFormSheet mode="edit" initial={list} onClose={close} />
      ) : null}
    </>
  );
}

function Option({
  label,
  danger = false,
  onSelect,
}: {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex min-h-14 items-center rounded-[13px] px-4 py-2 text-left text-[15px] font-medium transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
        danger ? "text-danger" : ""
      }`}
    >
      {label}
    </button>
  );
}
