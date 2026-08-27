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

// Air dates are anchored to midnight US Eastern (see `parseAirDate` in
// `lib/tmdb.ts`), so "today" has to be read in that same zone. Eastern is
// behind UTC, so the UTC calendar day rolls over hours before the Eastern one
// does — using `Date.now()`'s UTC day here made an episode airing at Eastern
// midnight tonight show as "Today" while it was still airing tomorrow.
const EASTERN_TODAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in `America/New_York`, as a day index comparable to `daysUntil`'s target. */
function easternTodayDayIndex(): number {
  const parts = EASTERN_TODAY_FORMAT.formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  const utcMidnight = Date.UTC(read("year"), read("month") - 1, read("day"));
  return Math.floor(utcMidnight / (24 * 60 * 60 * 1000));
}

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
  return Math.max(0, Math.floor(target / dayMs) - easternTodayDayIndex());
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
 * Watch progress as a whole percentage, for the bars on the cards and the show
 * header.
 *
 * The zero guard is the whole reason this is shared: a tracked show with
 * nothing aired yet is a real state — added from a search result before its
 * premiere — and `0 / 0` renders as "NaN%" in a progress bar rather than
 * failing anywhere a test would notice.
 */
export function progressPercent(watched: number, aired: number): number {
  if (aired <= 0) return 0;

  return Math.round((watched / aired) * 100);
}

/** 49 → "49m", 95 → "1h 35m". */
export function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * A coarse "how far off is this", for the caught-up card's countdown pill.
 *
 * Deliberately not `relativeAirDate`, and the difference is contextual rather
 * than an inconsistency: this pill sits directly beside the full date
 * ("Monday 21 Sep 2026"), so repeating it would be dead weight — what it adds
 * is the sense of scale that a date alone doesn't give. In the upcoming list
 * the relative date is the *only* date shown, so precision is what's wanted
 * there and `relativeAirDate` stays.
 */
export function countdownTo(iso: string): string {
  const days = daysUntil(iso);

  if (days === 0) return "Airs today";
  if (days === 1) return "Airs tomorrow";
  if (days < 14) return `In ${days} days`;

  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `In ${weeks} weeks`;
  }

  const months = Math.round(days / 30);
  return `In ${months} months`;
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

  const hasEnded = hasSeriesEnded(show.showStatus);

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
 * Whether TMDB says the series itself is over, as opposed to between seasons.
 *
 * TMDB reports most cancelled shows as "Ended" too, so treating anything that
 * isn't explicitly one of those two as still running is the safer default —
 * including a null status, which is what a show cached before this field was
 * synced still has.
 *
 * One definition rather than three: the Archive splits its fully-watched shows
 * on this, `caughtUpLabel` picks its wording from it, and `showMetaLine`
 * decides whether to close the year range with it. Two of those disagreeing
 * would file a show under "Finished" and then have its own card call it caught
 * up.
 */
export function hasSeriesEnded(showStatus: string | null): boolean {
  return showStatus === "Ended" || showStatus === "Canceled";
}

/**
 * What to say when there's nothing left to watch.
 *
 * A finished series and a show you're merely up to date with are different
 * situations, and TMDB's status is what tells them apart.
 */
export function caughtUpLabel(showStatus: string | null): string {
  return hasSeriesEnded(showStatus) ? "Series finished" : "Caught up";
}
