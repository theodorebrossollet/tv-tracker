import { episodeCode } from "@/lib/episode-code";
import { daysUntil } from "@/lib/format";
import type { UpcomingEpisode } from "@/lib/queries";

/**
 * The Upcoming list's shape. Inside the week, a header per air day and one row
 * per show per day, however many of its episodes land that day. Past the week,
 * one "Later" header and one row per show: its next episode, plus a count of
 * the ones after it.
 *
 * It used to be one row per episode, each with its own poster, show name and
 * date — so a show on a weekly schedule filled the list with its own name, and
 * a season dropped all at once took a whole screen to say one thing. A header
 * per day alone made that worse further out, where nearly every day holds one
 * weekly episode. Pure and client-safe; the component only lays out what this
 * returns.
 */

/**
 * Inside this many days the day is worth noticing rather than just reading,
 * so its header takes the accent and names the weekday instead of the date.
 */
export const SOON_DAYS = 7;

/** The header a row sits under: a `YYYY-MM-DD` day, or everything later. */
export type UpcomingGroup = string;
export const LATER = "later";

export interface UpcomingRow {
  /** Stable across renders: the first episode's id. */
  key: string;
  /** The broadcast date, `YYYY-MM-DD`. */
  day: string;
  /** `day` inside the week, `LATER` past it. */
  group: UpcomingGroup;
  /** Later rows only: this show's episodes after the ones on this row. */
  more: number;
  showId: string;
  showName: string;
  posterPath: string | null;
  status: UpcomingEpisode["status"];
  /** The day's episodes of this show, in air order. Never empty. */
  episodes: UpcomingEpisode[];
}

export interface UpcomingSection {
  group: UpcomingGroup;
  rows: UpcomingRow[];
}

/**
 * The broadcast date of an air date. Air dates are stored as midnight US
 * Eastern, which keeps the instant's UTC calendar date equal to the broadcast
 * date — see `parseAirDate` — so the UTC date is the right one to key on.
 */
export function airDay(airDate: Date): string {
  return airDate.toISOString().slice(0, 10);
}

/**
 * Collapses episodes into rows, in the order the episodes arrive (the query's
 * soonest-first order). Inside the week: one row per show per day. Past it:
 * one row per show, its first day there, with every later episode counted in
 * `more` rather than shown.
 */
export function upcomingRows(episodes: UpcomingEpisode[]): UpcomingRow[] {
  const rows: UpcomingRow[] = [];
  const byKey = new Map<string, UpcomingRow>();

  for (const episode of episodes) {
    const day = airDay(episode.airDate);
    const group = isSoon(day) ? day : LATER;
    const existing =
      byKey.get(`${day}:${episode.showId}`) ??
      (group === LATER ? byKey.get(`${LATER}:${episode.showId}`) : undefined);

    if (existing) {
      // Same show, same day: one more episode on the row. Same show, a later
      // day past the week: only counted.
      if (existing.day === day) existing.episodes.push(episode);
      else existing.more += 1;
      continue;
    }

    const row: UpcomingRow = {
      key: episode.episodeId,
      day,
      group,
      more: 0,
      showId: episode.showId,
      showName: episode.showName,
      posterPath: episode.posterPath,
      status: episode.status,
      episodes: [episode],
    };
    byKey.set(`${day}:${episode.showId}`, row);
    if (group === LATER) byKey.set(`${LATER}:${episode.showId}`, row);
    rows.push(row);
  }

  for (const row of rows) {
    row.episodes.sort(
      (a, b) =>
        a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber,
    );
  }

  return rows;
}

/** Consecutive rows of the same group, under one header. */
export function groupRows(rows: UpcomingRow[]): UpcomingSection[] {
  const sections: UpcomingSection[] = [];

  for (const row of rows) {
    const last = sections[sections.length - 1];
    if (last && last.group === row.group) last.rows.push(row);
    else sections.push({ group: row.group, rows: [row] });
  }

  return sections;
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  timeZone: "UTC",
});
const DAY_NO_YEAR = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const DAY_WITH_YEAR = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A section's header: the day inside the week, "Later" past it. */
export function groupLabel(group: UpcomingGroup): string {
  return group === LATER ? "Later" : dayLabel(group);
}

/**
 * "Today", "Tomorrow", the weekday within the week ("Friday"), then the date
 * ("Fri 28 Nov", with the year once it isn't this one). Inside a week the
 * weekday is the more useful answer, and further out it would be ambiguous.
 */
export function dayLabel(day: string): string {
  const iso = `${day}T12:00:00.000Z`;
  const days = daysUntil(iso);

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";

  const date = new Date(iso);
  if (days < SOON_DAYS) return WEEKDAY.format(date);

  const thisYear = new Date().getUTCFullYear() === date.getUTCFullYear();
  // en-GB puts a comma after the weekday once there's a year ("Wed, 6 Jan
  // 2027") and not without one; dropped so the two forms read alike.
  return (thisYear ? DAY_NO_YEAR : DAY_WITH_YEAR).format(date).replace(",", "");
}

/** Whether a day's header takes the accent. */
export function isSoon(day: string): boolean {
  return daysUntil(`${day}T12:00:00.000Z`) < SOON_DAYS;
}

/**
 * The line under a row's show name. One episode: its code and title. Several:
 * the span and the count ("S01E05–E08 · 4 episodes"), since a list of titles
 * is what the show page is for.
 */
export function rowDetail(row: UpcomingRow): string {
  const first = row.episodes[0];

  if (row.episodes.length === 1) {
    const code = episodeCode(first.seasonNumber, first.episodeNumber);
    return first.name ? `${code} · ${first.name}` : code;
  }

  const last = row.episodes[row.episodes.length - 1];
  const start = episodeCode(first.seasonNumber, first.episodeNumber);
  const end =
    last.seasonNumber === first.seasonNumber
      ? `E${String(last.episodeNumber).padStart(2, "0")}`
      : episodeCode(last.seasonNumber, last.episodeNumber);

  return `${start}–${end} · ${row.episodes.length} episodes`;
}
