"use client";

import { useState, useTransition } from "react";

import { createList, updateList } from "@/app/list-actions";
import { Sheet } from "@/components/sheet";
import { LIST_NAME_MAX, validateListName } from "@/lib/lists";

interface ListFormSheetProps {
  mode: "create" | "edit";
  /** Required for `edit`; ignored for `create`. */
  initial?: { id: string; name: string; trackSeparately: boolean };
  onClose: () => void;
  onSaved?: (id: string) => void;
}

/**
 * Create or rename a list, and choose whether it tracks watching separately.
 *
 * The fields are plain state seeded from `initial` once. That is deliberate and
 * safe here: they are a draft the person is typing, not a mirror of server
 * state, and the sheet is mounted fresh each time it opens.
 *
 * Validation runs here for fast feedback, but the action validates again and
 * is the authority — its error is shown the same way, held in state so it is
 * still there after the transition settles.
 */
export function ListFormSheet({
  mode,
  initial,
  onClose,
  onSaved,
}: ListFormSheetProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [together, setTogether] = useState(initial?.trackSeparately ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();

    const checked = validateListName(name);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);

    startTransition(async () => {
      const result =
        mode === "edit" && initial
          ? await updateList(initial.id, {
              name: checked.name,
              trackSeparately: together,
            }).then((r) => ({ ...r, id: initial.id }))
          : await createList(checked.name, together);

      if (!result.ok || !result.id) {
        setError(result.error ?? "Something went wrong. Please try again.");
        return;
      }

      onSaved?.(result.id);
      onClose();
    });
  }

  return (
    <Sheet title={mode === "edit" ? "Edit list" : "New list"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5 px-1.5 pb-1">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={LIST_NAME_MAX}
          aria-label="List name"
          placeholder="List name"
          autoFocus
          className="min-h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-[15px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />

        <div className="flex items-start gap-3">
          <input
            id="list-together"
            type="checkbox"
            checked={together}
            onChange={(event) => setTogether(event.target.checked)}
            aria-describedby="list-together-hint"
            className="mt-0.5 size-5 shrink-0 accent-accent"
          />
          <div className="min-w-0">
            <label
              htmlFor="list-together"
              className="block text-[14px] font-medium"
            >
              Track what you&apos;ve watched separately in this list
            </label>
            <p
              id="list-together-hint"
              className="mt-0.5 text-[12px] leading-relaxed text-muted"
            >
              Use this for a list you&apos;ll watch with other people. Each
              title gets its own tick, next to your real status.
            </p>
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="min-h-[46px] rounded-full bg-accent px-[22px] text-[15px] font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {mode === "edit" ? "Save" : "Create list"}
        </button>
      </form>
    </Sheet>
  );
}
