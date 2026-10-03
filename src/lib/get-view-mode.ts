import "server-only";

import { cookies } from "next/headers";

import { parseViewMode, VIEW_COOKIE, type ViewMode } from "@/lib/view-mode";

/**
 * The layout the visitor chose, read from their cookie. Reading it makes the
 * page dynamic, which every route that uses it already is.
 */
export async function getViewMode(): Promise<ViewMode> {
  return parseViewMode((await cookies()).get(VIEW_COOKIE)?.value);
}
