"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ListFormSheet } from "@/components/list-form-sheet";

/** Opens the create sheet, then goes to the list it made. */
export function NewListButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="min-h-10 rounded-full bg-accent px-[18px] text-[14px] font-semibold text-on-accent transition-opacity hover:opacity-90"
      >
        New list
      </button>

      {open ? (
        <ListFormSheet
          mode="create"
          onClose={() => setOpen(false)}
          onSaved={(id) => router.push(`/lists/${id}`)}
        />
      ) : null}
    </>
  );
}
