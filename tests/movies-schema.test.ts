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
const { TEST_USER_ID, resetDatabase, seedUser } = await import("./helpers");

async function seedMovie(id = "603") {
  await prisma.movie.create({ data: { id, title: "Test Movie" } });
  return id;
}

function track(userId: string, movieId: string, status = "watchlist") {
  return prisma.trackedMovie.create({ data: { userId, movieId, status } });
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
});

describe("TrackedMovie", () => {
  it("rejects tracking the same movie twice for one user", async () => {
    const movieId = await seedMovie();
    await track(TEST_USER_ID, movieId);

    const error = await track(TEST_USER_ID, movieId).catch((e: unknown) => e);

    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it("lets two users track the same movie", async () => {
    const movieId = await seedMovie();
    const other = await seedUser("other-user");

    await track(TEST_USER_ID, movieId);
    await track(other, movieId);

    expect(await prisma.trackedMovie.count({ where: { movieId } })).toBe(2);
  });

  it("is deleted with its movie", async () => {
    const movieId = await seedMovie();
    await track(TEST_USER_ID, movieId);

    await prisma.movie.delete({ where: { id: movieId } });

    expect(await prisma.trackedMovie.count()).toBe(0);
  });

  it("is deleted with its user", async () => {
    const movieId = await seedMovie();
    await track(TEST_USER_ID, movieId);

    await prisma.user.delete({ where: { id: TEST_USER_ID } });

    expect(await prisma.trackedMovie.count()).toBe(0);
    expect(await prisma.movie.count()).toBe(1);
  });
});

describe("clearAllData", () => {
  it("removes the caller's tracked movies and leaves other users' alone", async () => {
    const movieId = await seedMovie();
    const other = await seedUser("other-user");
    await track(TEST_USER_ID, movieId);
    await track(other, movieId, "watched");

    const result = await clearAllData();

    expect(result).toEqual({ ok: true });
    const remaining = await prisma.trackedMovie.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe(other);
  });
});
