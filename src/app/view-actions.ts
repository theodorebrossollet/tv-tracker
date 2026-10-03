"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { toResult, type ActionResult } from "@/lib/action-result";
import { requireOnboardedSession } from "@/lib/auth";
import {
  isViewMode,
  VIEW_COOKIE,
  VIEW_COOKIE_MAX_AGE,
} from "@/lib/view-mode";

// Governed by the rules in `actions.ts`'s header: the gate sits above the `try`
// and every argument is validated, even though this only sets a cookie.

/** Remembers the layout choice for this browser. */
export async function setViewMode(mode: string): Promise<ActionResult> {
  await requireOnboardedSession();

  if (!isViewMode(mode)) {
    return { ok: false, error: "Unknown view." };
  }

  try {
    (await cookies()).set(VIEW_COOKIE, mode, {
      path: "/",
      maxAge: VIEW_COOKIE_MAX_AGE,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
