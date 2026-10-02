import { beforeEach, describe, expect, it } from "vitest";

const { prisma } = await import("@/lib/prisma");
const { TEST_USER_ID, resetDatabase, seedShow, seedUser } = await import(
  "./helpers"
);

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
});

async function trackMovie() {
  await prisma.movie.create({ data: { id: "603", title: "Test Movie" } });
  return prisma.trackedMovie.create({
    data: { userId: TEST_USER_ID, movieId: "603", status: "watched" },
  });
}

async function watchEpisode() {
  const { episodeIds } = await seedShow({ offsets: [-1] });
  return prisma.watchedEpisode.create({
    data: { userId: TEST_USER_ID, episodeId: episodeIds[0] },
  });
}

describe("TrackedMovie.rating", () => {
  it("is null by default", async () => {
    const row = await trackMovie();

    expect(row.rating).toBeNull();
  });

  it("stores an integer and can be cleared to null", async () => {
    const row = await trackMovie();

    const rated = await prisma.trackedMovie.update({
      where: { id: row.id },
      data: { rating: 8 },
    });
    expect(rated.rating).toBe(8);

    const cleared = await prisma.trackedMovie.update({
      where: { id: row.id },
      data: { rating: null },
    });
    expect(cleared.rating).toBeNull();
  });
});

describe("WatchedEpisode.rating", () => {
  it("is null by default", async () => {
    const row = await watchEpisode();

    expect(row.rating).toBeNull();
  });

  it("stores an integer and can be cleared to null", async () => {
    const row = await watchEpisode();

    const rated = await prisma.watchedEpisode.update({
      where: { id: row.id },
      data: { rating: 10 },
    });
    expect(rated.rating).toBe(10);

    const cleared = await prisma.watchedEpisode.update({
      where: { id: row.id },
      data: { rating: null },
    });
    expect(cleared.rating).toBeNull();
  });

  it("loses its rating when the watched row is deleted", async () => {
    const row = await watchEpisode();
    await prisma.watchedEpisode.update({
      where: { id: row.id },
      data: { rating: 7 },
    });

    await prisma.watchedEpisode.delete({ where: { id: row.id } });

    expect(
      await prisma.watchedEpisode.findUnique({ where: { id: row.id } }),
    ).toBeNull();
  });
});
