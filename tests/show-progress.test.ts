import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shows")>()),
  ensureShowCached: vi.fn(async () => true),
}));

const { getShowDetail } = await import("@/lib/queries");
const { prisma } = await import("@/lib/prisma");
const { TEST_USER_ID, resetDatabase, seedUser } = await import("./helpers");

const DAY = 24 * 60 * 60 * 1000;

/** A multi-season show; `watched` names episodes as "S2E6". */
async function seedSeasons(
  seasons: { season: number; episodes: number; firstOffsetDays: number }[],
  watched: string[],
) {
  await prisma.show.create({
    data: { id: "multi", name: "Multi", status: "Returning Series" },
  });
  await prisma.trackedShow.create({
    data: { userId: TEST_USER_ID, showId: "multi", status: "watching" },
  });

  for (const { season, episodes, firstOffsetDays } of seasons) {
    for (let n = 1; n <= episodes; n++) {
      const code = `S${season}E${n}`;
      await prisma.episode.create({
        data: {
          id: `multi-${code}`,
          showId: "multi",
          seasonNumber: season,
          episodeNumber: n,
          name: code,
          airDate: new Date(Date.now() + (firstOffsetDays + (n - 1) * 7) * DAY),
          runtime: 45,
        },
      });
    }
  }

  for (const code of watched) {
    await prisma.watchedEpisode.create({
      data: { userId: TEST_USER_ID, episodeId: `multi-${code}` },
    });
  }
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
});

describe("the season pills and the Next-up queue count one thing", () => {
  // The show page derives these separately — the pills from each season's
  // aired/watched counts, the queue by filtering the episode list — and a
  // screenshot showed them disagreeing: a header reading 75%, a 5 on the
  // season-2 pill, and the caught-up card, which only renders when the queue
  // is empty. They are the same set counted two ways and cannot legitimately
  // differ, so this pins that rather than trusting it.
  const cases: { name: string; watched: string[] }[] = [
    { name: "midway through the latest season", watched: [
      ...Array.from({ length: 10 }, (_, i) => `S1E${i + 1}`),
      ...Array.from({ length: 5 }, (_, i) => `S2E${i + 1}`),
    ] },
    { name: "nothing watched", watched: [] },
    { name: "everything watched", watched: [
      ...Array.from({ length: 10 }, (_, i) => `S1E${i + 1}`),
      ...Array.from({ length: 10 }, (_, i) => `S2E${i + 1}`),
    ] },
    { name: "an early season left unfinished", watched: ["S1E1", "S2E1", "S2E2"] },
  ];

  for (const { name, watched } of cases) {
    it(`agrees when ${name}`, async () => {
      // Both seasons fully aired: every episode is a candidate for the queue.
      await seedSeasons(
        [
          { season: 1, episodes: 10, firstOffsetDays: -400 },
          { season: 2, episodes: 10, firstOffsetDays: -67 },
        ],
        watched,
      );

      const show = (await getShowDetail(TEST_USER_ID, "multi"))!;
      const queue = show.seasons
        .flatMap((season) => season.episodes)
        .filter((episode) => episode.aired && !episode.watched);
      const pills = show.seasons.reduce(
        (total, season) => total + (season.airedCount - season.watchedCount),
        0,
      );

      expect(queue.length).toBe(pills);
      expect(queue.length).toBe(show.airedCount - show.watchedCount);
    });
  }

  it("puts the caught-up card and a full pill in mutually exclusive states", async () => {
    // The screenshot's exact shape: 15 of 20 watched, five outstanding on
    // season 2. An empty queue is what puts the caught-up card on screen, so
    // if this show is behind, that card must not be the one rendered.
    await seedSeasons(
      [
        { season: 1, episodes: 10, firstOffsetDays: -400 },
        { season: 2, episodes: 10, firstOffsetDays: -67 },
      ],
      [
        ...Array.from({ length: 10 }, (_, i) => `S1E${i + 1}`),
        ...Array.from({ length: 5 }, (_, i) => `S2E${i + 1}`),
      ],
    );

    const show = (await getShowDetail(TEST_USER_ID, "multi"))!;
    const queue = show.seasons
      .flatMap((season) => season.episodes)
      .filter((episode) => episode.aired && !episode.watched);

    expect(show.airedCount).toBe(20);
    expect(show.watchedCount).toBe(15);
    expect(show.seasons[1].airedCount - show.seasons[1].watchedCount).toBe(5);
    expect(queue.length).toBeGreaterThan(0);
    expect(queue[0].name).toBe("S2E6");
  });
});
