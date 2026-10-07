import { describe, expect, it } from "vitest";

import { pickOwnTitles, type OwnTitle } from "@/lib/discover";

const NOW = new Date("2026-10-07T15:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function title(id: number, ageDays: number, kind: "movie" | "show" = "movie"): OwnTitle {
  return {
    card: {
      source: "own",
      kind,
      id: String(id),
      title: `T${id}`,
      posterPath: null,
      year: null,
    },
    runtime: null,
    addedAt: NOW.getTime() - ageDays * DAY_MS,
  };
}

const old = (n: number, startId = 1) =>
  Array.from({ length: n }, (_, i) => title(startId + i, 400 + i));

const ids = (picked: OwnTitle[]) => picked.map((t) => `${t.card.kind}:${t.card.id}`);

describe("pickOwnTitles", () => {
  it("returns everything, in some order, when the pool fits", () => {
    const pool = old(6);
    expect(ids(pickOwnTitles(pool, "seed", NOW)).sort()).toEqual(ids(pool).sort());
  });

  it("returns nothing for an empty pool or a zero cap", () => {
    expect(pickOwnTitles([], "seed", NOW)).toEqual([]);
    expect(pickOwnTitles(old(5), "seed", NOW, 0)).toEqual([]);
  });

  it("caps the pick, with no title twice", () => {
    const picked = ids(pickOwnTitles(old(50), "seed", NOW, 10));
    expect(picked).toHaveLength(10);
    expect(new Set(picked).size).toBe(10);
  });

  it("is repeatable for one seed, whatever order the pool arrives in", () => {
    const pool = old(40);
    const first = ids(pickOwnTitles(pool, "u1:2026-10-07", NOW));
    const again = ids(pickOwnTitles([...pool].reverse(), "u1:2026-10-07", NOW));
    expect(again).toEqual(first);
  });

  it("differs between seeds (another day, another account)", () => {
    const pool = old(40);
    const day1 = ids(pickOwnTitles(pool, "u1:2026-10-07", NOW));
    const day2 = ids(pickOwnTitles(pool, "u1:2026-10-08", NOW));
    const other = ids(pickOwnTitles(pool, "u2:2026-10-07", NOW));
    expect(day2).not.toEqual(day1);
    expect(other).not.toEqual(day1);
  });

  it("reaches the whole pool over time, not just the newest", () => {
    const pool = old(40);
    const seen = new Set<string>();
    for (let day = 1; day <= 30; day++) {
      ids(pickOwnTitles(pool, `u1:2026-09-${day}`, NOW)).forEach((id) => seen.add(id));
    }
    expect(seen.size).toBeGreaterThan(35);
  });

  it("changes at most one title when one is added or removed", () => {
    for (let day = 1; day <= 25; day++) {
      const seed = `u1:2026-09-${day}`;
      const pool = old(40);
      const before = ids(pickOwnTitles(pool, seed, NOW));

      const added = ids(pickOwnTitles([...pool, title(999, 500)], seed, NOW));
      expect(before.filter((id) => !added.includes(id)).length).toBeLessThanOrEqual(1);

      const removed = ids(pickOwnTitles(pool.slice(1), seed, NOW));
      expect(before.filter((id) => !removed.includes(id)).length).toBeLessThanOrEqual(1);
    }
  });

  it("favours a recently added title without guaranteeing it", () => {
    const pool = [...old(30), title(777, 0)];
    let fresh = 0;
    let stale = 0;
    const days = 200;
    for (let day = 0; day < days; day++) {
      const picked = ids(pickOwnTitles(pool, `u1:d${day}`, NOW));
      if (picked.includes("movie:777")) fresh++;
      if (picked.includes("movie:30")) stale++; // an old one, for comparison
    }

    // Weight 3 against 1: clearly more often than an old title, never always.
    expect(fresh).toBeGreaterThan(stale * 1.4);
    expect(fresh).toBeLessThan(days);
  });

  it("lets the head start fade: a title a year old is picked like any other", () => {
    const pool = [...old(30), title(778, 365)];
    let year = 0;
    let other = 0;
    for (let day = 0; day < 300; day++) {
      const picked = ids(pickOwnTitles(pool, `u1:d${day}`, NOW));
      if (picked.includes("movie:778")) year++;
      if (picked.includes("movie:30")) other++;
    }
    expect(Math.abs(year - other)).toBeLessThan(40);
  });

  it("treats a title dated in the future like one added just now, without NaN", () => {
    const future = title(5, -3);
    const picked = pickOwnTitles([future, ...old(3)], "seed", NOW, 4);
    expect(picked).toHaveLength(4);
  });

  it("keeps a movie and a show with the same id apart", () => {
    const picked = ids(pickOwnTitles([title(5, 400, "movie"), title(5, 400, "show")], "seed", NOW));
    expect(picked.sort()).toEqual(["movie:5", "show:5"]);
  });
});
