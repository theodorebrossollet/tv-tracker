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

/**
 * Builds the metadata line under a show's synopsis, e.g.
 * "2007–2015 · AMC · Drama" or "2022–present · HBO · Drama".
 *
 * Years are read in UTC to match how air dates are stored (midnight US Eastern,
 * whose UTC calendar date is the broadcast date). Reading them locally would
 * show the previous year for anything airing on 1 January.
 *
 * The range only closes for a show that has actually finished — a running show
 * gets "–present" rather than its most recent episode's year, which would read
 * as an end date it hasn't reached.
 */
export function showMetaLine(show: {
  firstAirDate: Date | string | null;
  lastAirDate: Date | string | null;
  showStatus: string | null;
  network: string | null;
  genres: string | null;
}): string | null {
  const year = (value: Date | string | null) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
  };

  const first = year(show.firstAirDate);
  const last = year(show.lastAirDate);

  // TMDB reports most cancelled shows as "Ended" too, so treating anything
  // that isn't explicitly ended as ongoing is the safer default.
  const hasEnded =
    show.showStatus === "Ended" || show.showStatus === "Canceled";

  let years: string | null = null;
  if (first !== null) {
    if (hasEnded) {
      years = last !== null && last !== first ? `${first}–${last}` : `${first}`;
    } else {
      years = `${first}–present`;
    }
  }

  // The status word only earns its place when the years don't already say it:
  // "2007–2015" means ended, "2022–present" means running. What a date range
  // can't express is cancellation, or a show with no air dates at all.
  let status: string | null = null;
  if (show.showStatus === "Canceled") {
    status = "Canceled";
  } else if (years === null && show.showStatus) {
    status = show.showStatus === "Returning Series"
      ? "Returning"
      : show.showStatus;
  }

  const parts = [years, status, show.network, show.genres].filter(
    (part): part is string => Boolean(part),
  );

  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * What to say when there's nothing left to watch.
 *
 * A finished series and a show you're merely up to date with are different
 * situations, and TMDB's status is what tells them apart.
 */
export function caughtUpLabel(showStatus: string | null): string {
  return showStatus === "Ended" || showStatus === "Canceled"
    ? "Series finished"
    : "Caught up";
}
