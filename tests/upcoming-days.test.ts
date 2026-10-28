import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpcomingEpisode } from "@/lib/queries";
import {
  airDay,
  dayLabel,
  groupRows,
  LATER,
  rowDetail,
  upcomingRows,
} from "@/lib/upcoming-days";

// Air dates as the app stores them: midnight US Eastern, 04:00 UTC in summer.
const on = (day: string) => new Date(`${day}T04:00:00.000Z`);

const ep = (over: Partial<UpcomingEpisode>): UpcomingEpisode => ({
  episodeId: "e",
  showId: "1",
  showName: "Severance",
  posterPath: null,
  status: "watching",
  seasonNumber: 1,
  episodeNumber: 1,
  name: null,
  airDate: on("2026-08-03"),
  ...over,
});

// "Today" for every test: the Wednesday before the fixtures' default day, so
// 3 Aug is inside the week and 10 Aug is past it. Noon UTC is inside the same
// calendar day in US Eastern, which is the "today" `daysUntil` counts from.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("airDay", () => {
  it("keys on the broadcast date, which is the stored instant's UTC date", () => {
    expect(airDay(on("2026-08-03"))).toBe("2026-08-03");
    // Midnight Eastern in winter is 05:00 UTC: still the same date.
    expect(airDay(new Date("2026-12-01T05:00:00.000Z"))).toBe("2026-12-01");
  });
});

describe("upcomingRows", () => {
  it("inside the week, collapses a show's episodes on one day and keeps days and shows apart", () => {
    const rows = upcomingRows([
      ep({ episodeId: "a", episodeNumber: 1 }),
      ep({ episodeId: "x", showId: "2", showName: "Dark" }),
      ep({ episodeId: "b", episodeNumber: 2 }),
      ep({ episodeId: "c", episodeNumber: 3, airDate: on("2026-08-04") }),
    ]);

    expect(rows.map((row) => [row.group, row.showName, row.episodes.length])).toEqual([
      ["2026-08-03", "Severance", 2],
      ["2026-08-03", "Dark", 1],
      ["2026-08-04", "Severance", 1],
    ]);
    expect(rows[0].key).toBe("a");
  });

  it("past the week, gives each show one row and counts the rest", () => {
    // A weekly show: one episode this week, four after it. The four used to be
    // four rows each repeating the show's name and poster.
    const rows = upcomingRows([
      ep({ episodeId: "a", episodeNumber: 1 }),
      ep({ episodeId: "b", episodeNumber: 2, airDate: on("2026-08-10") }),
      ep({ episodeId: "x", showId: "2", showName: "Dark", airDate: on("2026-08-12") }),
      ep({ episodeId: "c", episodeNumber: 3, airDate: on("2026-08-17") }),
      ep({ episodeId: "d", episodeNumber: 4, airDate: on("2026-08-24") }),
      ep({ episodeId: "e", episodeNumber: 5, airDate: on("2026-08-31") }),
    ]);

    expect(rows.map((row) => [row.group, row.showName, row.day, row.more])).toEqual([
      ["2026-08-03", "Severance", "2026-08-03", 0],
      [LATER, "Severance", "2026-08-10", 3],
      [LATER, "Dark", "2026-08-12", 0],
    ]);
  });

  it("still collapses a same-day drop past the week into its show's one row", () => {
    const [row] = upcomingRows([
      ep({ episodeId: "a", episodeNumber: 1, airDate: on("2026-08-20") }),
      ep({ episodeId: "b", episodeNumber: 2, airDate: on("2026-08-20") }),
      ep({ episodeId: "c", episodeNumber: 3, airDate: on("2026-08-27") }),
    ]);

    expect([row.group, row.episodes.length, row.more]).toEqual([LATER, 2, 1]);
  });

  it("puts a collapsed row's episodes in air order whatever order they arrived in", () => {
    // The query orders by air date only, so a same-day drop arrives in
    // whatever order the database returns its ties.
    const [row] = upcomingRows([
      ep({ episodeId: "c", episodeNumber: 3 }),
      ep({ episodeId: "a", episodeNumber: 1 }),
      ep({ episodeId: "b", episodeNumber: 2 }),
    ]);

    expect(row.episodes.map((e) => e.episodeNumber)).toEqual([1, 2, 3]);
  });
});

describe("groupRows", () => {
  it("puts consecutive rows of a day under one header, and everything later under one", () => {
    const sections = groupRows(
      upcomingRows([
        ep({ episodeId: "a" }),
        ep({ episodeId: "b", showId: "2" }),
        ep({ episodeId: "c", airDate: on("2026-08-04") }),
        ep({ episodeId: "d", airDate: on("2026-08-11") }),
        ep({ episodeId: "e", showId: "2", airDate: on("2026-08-20") }),
      ]),
    );

    expect(sections.map((d) => [d.group, d.rows.length])).toEqual([
      ["2026-08-03", 2],
      ["2026-08-04", 1],
      [LATER, 2],
    ]);
  });
});

describe("dayLabel", () => {
  it("names today, tomorrow and the weekday inside a week, then the date", () => {
    expect(dayLabel("2026-07-29")).toBe("Today");
    expect(dayLabel("2026-07-30")).toBe("Tomorrow");
    expect(dayLabel("2026-08-04")).toBe("Tuesday");
    expect(dayLabel("2026-08-05")).toBe("Wed 5 Aug");
    expect(dayLabel("2027-01-06")).toBe("Wed 6 Jan 2027");
  });
});

describe("rowDetail", () => {
  it("gives one episode its code and title", () => {
    const [row] = upcomingRows([ep({ seasonNumber: 2, episodeNumber: 5, name: "Trojan's Horse" })]);
    expect(rowDetail(row)).toBe("S02E05 · Trojan's Horse");
  });

  it("gives several the span and a count, naming the season again only if it changes", () => {
    const [sameSeason] = upcomingRows([
      ep({ episodeId: "a", episodeNumber: 5 }),
      ep({ episodeId: "b", episodeNumber: 8 }),
    ]);
    expect(rowDetail(sameSeason)).toBe("S01E05–E08 · 2 episodes");

    const [acrossSeasons] = upcomingRows([
      ep({ episodeId: "a", seasonNumber: 1, episodeNumber: 10 }),
      ep({ episodeId: "b", seasonNumber: 2, episodeNumber: 1 }),
    ]);
    expect(rowDetail(acrossSeasons)).toBe("S01E10–S02E01 · 2 episodes");
  });
});
