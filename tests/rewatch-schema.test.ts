import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Same stub as tracking.test.ts: the gate has its own coverage in auth.test.ts.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "test-session",
    user: { id: "test-user", nickname: "test-user", hasPassword: true },
  })),
}));

const { clearAllData } = await import("@/app/actions");
const { isUniqueConstraintError } = await import("@/lib/action-result");
const { prisma } = await import("@/lib/prisma");
const { TEST_USER_ID, resetDatabase, seedShow, seedUser } = await import(
  "./helpers"
);

async function seedMovie(id = "603") {
  await prisma.movie.create({ data: { id, title: "Test Movie" } });
  return id;
}

/** A show with two episodes, returning the show id and episode ids. */
async function seedTwoEpisodes(showId = "show-1") {
  await seedShow({ showId, offsets: [-2, -1] });
  const episodes = await prisma.episode.findMany({
    where: { showId },
    orderBy: { episodeNumber: "asc" },
  });
  return { showId, episodeIds: episodes.map((e) => e.id) };
}

function makeRun(userId: string, showId: string, runNumber = 1) {
  return prisma.showRun.create({ data: { userId, showId, runNumber } });
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
});

describe("ShowRun", () => {
  it("stores archived watches with their dates and ratings", async () => {
    const { showId, episodeIds } = await seedTwoEpisodes();
    const run = await makeRun(TEST_USER_ID, showId);
    const d1 = new Date("2025-01-02T03:04:05Z");
    const d2 = new Date("2025-02-03T04:05:06Z");
    await prisma.archivedEpisodeWatch.createMany({
      data: [
        { runId: run.id, episodeId: episodeIds[0], watchedAt: d1, rating: 8 },
        { runId: run.id, episodeId: episodeIds[1], watchedAt: d2 },
      ],
    });

    const rows = await prisma.archivedEpisodeWatch.findMany({
      where: { runId: run.id },
      orderBy: { watchedAt: "asc" },
    });

    expect(rows.map((r) => r.watchedAt)).toEqual([d1, d2]);
    expect(rows.map((r) => r.rating)).toEqual([8, null]);
    expect(run.archivedAt).toBeInstanceOf(Date);
  });

  it("rejects a repeated run number for the same account and show", async () => {
    const { showId } = await seedTwoEpisodes();
    await makeRun(TEST_USER_ID, showId, 1);

    const error = await makeRun(TEST_USER_ID, showId, 1).catch(
      (e: unknown) => e,
    );

    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it("lets another account or another show reuse the number", async () => {
    const { showId } = await seedTwoEpisodes();
    const { showId: otherShow } = await seedTwoEpisodes("show-2");
    const other = await seedUser("other-user");
    await makeRun(TEST_USER_ID, showId, 1);

    await makeRun(other, showId, 1);
    await makeRun(TEST_USER_ID, otherShow, 1);

    expect(await prisma.showRun.count()).toBe(3);
  });

  it("deletes its archived watches with it", async () => {
    const { showId, episodeIds } = await seedTwoEpisodes();
    const run = await makeRun(TEST_USER_ID, showId);
    await prisma.archivedEpisodeWatch.create({
      data: { runId: run.id, episodeId: episodeIds[0], watchedAt: new Date() },
    });

    await prisma.showRun.delete({ where: { id: run.id } });

    expect(await prisma.archivedEpisodeWatch.count()).toBe(0);
  });

  it("loses archived watches with their episode but keeps the run", async () => {
    const { showId, episodeIds } = await seedTwoEpisodes();
    const run = await makeRun(TEST_USER_ID, showId);
    await prisma.archivedEpisodeWatch.create({
      data: { runId: run.id, episodeId: episodeIds[0], watchedAt: new Date() },
    });

    await prisma.episode.delete({ where: { id: episodeIds[0] } });

    expect(await prisma.archivedEpisodeWatch.count()).toBe(0);
    expect(await prisma.showRun.count()).toBe(1);
  });

  it("is deleted with its user", async () => {
    const { showId, episodeIds } = await seedTwoEpisodes();
    const run = await makeRun(TEST_USER_ID, showId);
    await prisma.archivedEpisodeWatch.create({
      data: { runId: run.id, episodeId: episodeIds[0], watchedAt: new Date() },
    });

    await prisma.user.delete({ where: { id: TEST_USER_ID } });

    expect(await prisma.showRun.count()).toBe(0);
    expect(await prisma.archivedEpisodeWatch.count()).toBe(0);
    expect(await prisma.show.count()).toBe(1);
  });

  it("is deleted with its show", async () => {
    const { showId, episodeIds } = await seedTwoEpisodes();
    const run = await makeRun(TEST_USER_ID, showId);
    await prisma.archivedEpisodeWatch.create({
      data: { runId: run.id, episodeId: episodeIds[0], watchedAt: new Date() },
    });

    await prisma.show.delete({ where: { id: showId } });

    expect(await prisma.showRun.count()).toBe(0);
    expect(await prisma.archivedEpisodeWatch.count()).toBe(0);
  });
});

describe("PastMovieWatch", () => {
  it("stores the date and rating, and allows no rating", async () => {
    const movieId = await seedMovie();
    const watchedAt = new Date("2025-03-04T05:06:07Z");
    await prisma.pastMovieWatch.create({
      data: { userId: TEST_USER_ID, movieId, watchedAt, rating: 9 },
    });
    await prisma.pastMovieWatch.create({
      data: { userId: TEST_USER_ID, movieId, watchedAt },
    });

    const rows = await prisma.pastMovieWatch.findMany({
      orderBy: { rating: "asc" },
    });

    expect(rows.map((r) => r.rating)).toEqual([null, 9]);
    expect(rows[0].watchedAt).toEqual(watchedAt);
    expect(rows[0].archivedAt).toBeInstanceOf(Date);
  });

  it("is deleted with its movie", async () => {
    const movieId = await seedMovie();
    await prisma.pastMovieWatch.create({
      data: { userId: TEST_USER_ID, movieId, watchedAt: new Date() },
    });

    await prisma.movie.delete({ where: { id: movieId } });

    expect(await prisma.pastMovieWatch.count()).toBe(0);
  });

  it("is deleted with its user", async () => {
    const movieId = await seedMovie();
    await prisma.pastMovieWatch.create({
      data: { userId: TEST_USER_ID, movieId, watchedAt: new Date() },
    });

    await prisma.user.delete({ where: { id: TEST_USER_ID } });

    expect(await prisma.pastMovieWatch.count()).toBe(0);
    expect(await prisma.movie.count()).toBe(1);
  });
});

describe("clearAllData", () => {
  it("removes the caller's runs and past watches and leaves other users' alone", async () => {
    const { showId, episodeIds } = await seedTwoEpisodes();
    const movieId = await seedMovie();
    const other = await seedUser("other-user");
    for (const userId of [TEST_USER_ID, other]) {
      const run = await makeRun(userId, showId);
      await prisma.archivedEpisodeWatch.create({
        data: { runId: run.id, episodeId: episodeIds[0], watchedAt: new Date() },
      });
      await prisma.pastMovieWatch.create({
        data: { userId, movieId, watchedAt: new Date() },
      });
    }

    const result = await clearAllData();

    expect(result).toEqual({ ok: true });
    const runs = await prisma.showRun.findMany();
    expect(runs.map((r) => r.userId)).toEqual([other]);
    const archived = await prisma.archivedEpisodeWatch.findMany();
    expect(archived.map((a) => a.runId)).toEqual([runs[0].id]);
    const past = await prisma.pastMovieWatch.findMany();
    expect(past.map((p) => p.userId)).toEqual([other]);
  });
});
