import { afterEach, describe, expect, it, vi } from "vitest";

import {
  caughtUpLabel,
  daysUntil,
  formatAirDate,
  formatAirDateShort,
  relativeAirDate,
  showMetaLine,
} from "@/lib/format";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatAirDate", () => {
  it("formats an ISO instant as a plain date", () => {
    expect(formatAirDate("2026-07-30T04:00:00.000Z")).toBe("30 Jul 2026");
  });

  it("uses the UTC calendar day regardless of the machine's timezone", () => {
    // Air dates are stored as midnight US Eastern. Formatting in local time
    // would show the previous day for anyone west of UTC.
    expect(formatAirDate("2026-01-15T05:00:00.000Z")).toBe("15 Jan 2026");
  });

  it("falls back to TBA for missing or unparseable input", () => {
    expect(formatAirDate(null)).toBe("TBA");
    expect(formatAirDate("")).toBe("TBA");
    expect(formatAirDate("not a date")).toBe("TBA");
  });
});

describe("formatAirDateShort", () => {
  it("drops the year for dates in the current year", () => {
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));

    expect(formatAirDateShort("2026-08-06T04:00:00.000Z")).toBe("6 Aug");
  });

  it("keeps the year for other years", () => {
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));

    expect(formatAirDateShort("2025-08-06T04:00:00.000Z")).toBe("6 Aug 2025");
  });
});

describe("daysUntil", () => {
  it("counts whole days ahead", () => {
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));

    expect(daysUntil("2026-08-01T04:00:00.000Z")).toBe(3);
  });

  it("floors at zero for dates in the past", () => {
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));

    expect(daysUntil("2026-07-01T04:00:00.000Z")).toBe(0);
  });
});

describe("relativeAirDate", () => {
  it("says Today for an air date later the same day", () => {
    vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));

    expect(relativeAirDate("2026-07-30T04:00:00.000Z")).toBe("Today");
  });

  it("says Tomorrow one day out", () => {
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));

    expect(relativeAirDate("2026-07-30T04:00:00.000Z")).toBe("Tomorrow");
  });

  it("counts days within the coming week", () => {
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));

    expect(relativeAirDate("2026-08-01T04:00:00.000Z")).toBe("In 3 days");
  });

  it("switches to a plain date beyond a week", () => {
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));

    expect(relativeAirDate("2026-08-20T04:00:00.000Z")).toBe("20 Aug");
  });
});

describe("showMetaLine", () => {
  const base = {
    firstAirDate: new Date("2007-07-19T04:00:00.000Z"),
    lastAirDate: new Date("2015-05-17T04:00:00.000Z"),
    showStatus: "Ended",
    network: "AMC",
    genres: "Drama",
  };

  it("closes the range for an ended show, without saying so twice", () => {
    // "2007–2015" already means ended; repeating it adds nothing.
    expect(showMetaLine(base)).toBe("2007–2015 · AMC · Drama");
  });

  it("uses –present for a returning show rather than its latest episode year", () => {
    // lastAirDate is just the most recent episode, not an end date; printing it
    // as one would say a running show had finished.
    expect(
      showMetaLine({
        ...base,
        firstAirDate: new Date("2022-08-21T04:00:00.000Z"),
        showStatus: "Returning Series",
        network: "HBO",
      }),
    ).toBe("2022–present · HBO · Drama");
  });

  it("keeps Canceled, which a date range cannot express", () => {
    // "ended in 2015" and "cancelled in 2015" are different facts.
    expect(showMetaLine({ ...base, showStatus: "Canceled" })).toBe(
      "2007–2015 · Canceled · AMC · Drama",
    );
  });

  it("collapses a single-year run to one year", () => {
    expect(
      showMetaLine({
        ...base,
        lastAirDate: new Date("2007-12-01T05:00:00.000Z"),
      }),
    ).toBe("2007 · AMC · Drama");
  });

  it("omits the years for a show that hasn't aired", () => {
    expect(
      showMetaLine({
        ...base,
        firstAirDate: null,
        lastAirDate: null,
        showStatus: "In Production",
      }),
    ).toBe("In Production · AMC · Drama");
  });

  it("reads years in UTC so a 1 January premiere isn't off by one", () => {
    expect(
      showMetaLine({
        ...base,
        firstAirDate: new Date("2010-01-01T05:00:00.000Z"),
        lastAirDate: new Date("2012-01-01T05:00:00.000Z"),
      }),
    ).toBe("2010–2012 · AMC · Drama");
  });

  it("returns null when TMDB gave us nothing", () => {
    expect(
      showMetaLine({
        firstAirDate: null,
        lastAirDate: null,
        showStatus: null,
        network: null,
        genres: null,
      }),
    ).toBeNull();
  });
});

describe("caughtUpLabel", () => {
  it("distinguishes a finished series from being merely up to date", () => {
    expect(caughtUpLabel("Ended")).toBe("Series finished");
    expect(caughtUpLabel("Canceled")).toBe("Series finished");
    expect(caughtUpLabel("Returning Series")).toBe("Caught up");
    expect(caughtUpLabel(null)).toBe("Caught up");
  });
});
