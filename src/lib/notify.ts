import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";

// Toasts for writes made from a control that has nowhere to put an error: a
// round ✓ on a card, a swipe, an episode's checkbox. Those used to await the
// action and drop its result, so a failed save looked like the tick quietly
// changing its mind.
//
// Not for forms or sheets. A form's error belongs beside the field, and a
// sheet is a modal dialog: it sits in the top layer and makes the rest of
// the page inert, the toaster included, so a toast raised from inside one is
// drawn underneath it and can't be operated.
//
// No `"use client"` here on purpose. Only client components import this, and
// marking it would turn its exports into client references for any server
// module that later reached for one (see `tests/client-boundary.test.ts`).

const GENERIC = "Something went wrong. Please try again.";
const UNREACHABLE = "Couldn't save. Check your connection and try again.";

/**
 * Runs a server action and says so if it did not work. Resolves to whether it
 * did, so the caller can do something only on success.
 *
 * The call is caught as well as its result read: with no connection the
 * request itself rejects, and uncaught inside a transition that lands in
 * `app/error.tsx`, replacing the whole page over one tick. `unstable_rethrow`
 * goes first because Next reports an action's `redirect` (an expired session
 * being sent to sign in) as a rejection too, and that one has to keep going.
 */
export async function attempt(
  action: () => Promise<ActionResult>,
): Promise<boolean> {
  let result: ActionResult | undefined;

  try {
    result = await action();
  } catch (error) {
    unstable_rethrow(error);
    // The message is the id, so the same failure repeated (five quick taps
    // with no signal) replaces its toast instead of stacking five.
    toast.error(UNREACHABLE, { id: UNREACHABLE });
    return false;
  }

  if (result?.ok) return true;

  const message = result?.error ?? GENERIC;
  toast.error(message, { id: message });
  return false;
}

/**
 * A confirmation with a way back, for a write that is easy to make by
 * accident. `undo` runs through `attempt`, so a failed undo reports itself.
 */
export function notifyUndoable(
  message: string,
  undo: () => Promise<ActionResult>,
): void {
  toast(message, {
    action: { label: "Undo", onClick: () => void attempt(undo) },
  });
}
