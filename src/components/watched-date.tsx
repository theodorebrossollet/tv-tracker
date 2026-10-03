"use client";

import { useSyncExternalStore } from "react";

import { APP_TIME_ZONE, formatWatchedDate } from "@/lib/format";

const subscribe = () => () => {};

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || APP_TIME_ZONE;
  } catch {
    return APP_TIME_ZONE;
  }
}

/**
 * The viewer's timezone. The server snapshot is the app zone, so the server
 * render and the hydration pass agree; React then re-renders with the browser's
 * zone, with no mismatch.
 */
export function useViewerTimeZone(): string {
  return useSyncExternalStore(subscribe, browserTimeZone, () => APP_TIME_ZONE);
}

/** A watch instant as "1 Oct 2026", on the viewer's calendar day. */
export function WatchedDate({ iso }: { iso: string | null | undefined }) {
  return <>{formatWatchedDate(iso, useViewerTimeZone())}</>;
}

/** "5 Jan 2026 – 9 Feb 2026"; one date for a single day; nothing with no dates. */
export function WatchedRange({
  first,
  last,
}: {
  first: string | null;
  last: string | null;
}) {
  const zone = useViewerTimeZone();
  const a = first ? formatWatchedDate(first, zone) : null;
  const b = last ? formatWatchedDate(last, zone) : null;

  if (a && b) return <>{a === b ? a : `${a} – ${b}`}</>;
  return <>{a ?? b ?? ""}</>;
}
