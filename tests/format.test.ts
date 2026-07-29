import { afterEach, describe, expect, it, vi } from "vitest";

import {
  daysUntil,
  formatAirDate,
  formatAirDateShort,
  relativeAirDate,
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
