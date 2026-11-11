// The look of a text field and of the full-width button under a form, shared
// by the sign-in screens and `SecretInput` so they can't drift apart.
//
// A plain module, not a component, and deliberately not `"use client"`: both
// server pages and client forms read these strings, and a value exported from
// a client module reaches a server component as a reference, not a string
// (see `tests/client-boundary.test.ts`).

/**
 * 16px text is load-bearing: anything smaller makes iOS Safari zoom the page
 * when the field takes focus (the same reason `select.tsx` gives). A field
 * keeps its hairline, since the edge is how you find it; see AGENTS.md.
 */
export const FIELD_CLASS =
  "min-h-12 w-full rounded-xl border border-border bg-surface px-3.5 text-base outline-none transition-colors placeholder:text-faint focus:border-accent disabled:opacity-60";

export const FIELD_LABEL_CLASS = "mb-1.5 block text-[13px] font-medium text-muted";

/** The one primary action of a form: white, full width, as tall as the hero's. */
export const SUBMIT_CLASS =
  "flex min-h-[50px] w-full items-center justify-center rounded-full bg-accent px-6 text-[16px] font-bold text-on-accent transition-opacity disabled:opacity-50";
