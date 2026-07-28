// Date helpers shared by server and client components.
//
// Everything is formatted in UTC with a fixed locale on purpose: air dates from
// TMDB are calendar dates, not instants, and letting the server and the browser
// each apply their own timezone would produce different text on each side and
// trigger a hydration mismatch.

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DATE_FORMAT_NO_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** ISO string → "14 Mar 2026". Returns "TBA" for missing dates. */
export function formatAirDate(iso: string | null | undefined): string {
  if (!iso) return "TBA";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "TBA";

  return DATE_FORMAT.format(date);
}

/** Same, but drops the year for dates in the current year. */
export function formatAirDateShort(iso: string | null | undefined): string {
  if (!iso) return "TBA";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "TBA";

  const thisYear = new Date().getUTCFullYear() === date.getUTCFullYear();
  return thisYear ? DATE_FORMAT_NO_YEAR.format(date) : DATE_FORMAT.format(date);
}

/** Whole days from today until the given date, floored at 0. */
export function daysUntil(iso: string): number {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;

  const dayMs = 24 * 60 * 60 * 1000;
  const todayUtc = Math.floor(Date.now() / dayMs);
  return Math.max(0, Math.floor(target / dayMs) - todayUtc);
}

/** "Today", "Tomorrow", "in 5 days", or the plain date further out. */
export function relativeAirDate(iso: string): string {
  const days = daysUntil(iso);

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;

  return formatAirDateShort(iso);
}
