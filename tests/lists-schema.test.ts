import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Same stub as tracking.test.ts: the gate has its own coverage in auth.test.ts.
vi.mock("@/lib/auth", async (importOriginal) => {
  const { TEST_USER_ID } = await import("./helpers");
  return {
    ...(await importOriginal<typeof import("@/lib/auth")>()),
    requireOnboardedSession: vi.fn(async () => ({
      sessionId: "test-session",
      user: { id: TEST_USER_ID, nickname: TEST_USER_ID, hasPassword: true },
    })),
  };
});

const { clearAllData } = await import("@/app/actions");
const { isUniqueConstraintError } = await import("@/lib/action-result");
const { prisma } = await import("@/lib/prisma");
const { TEST_USER_ID, resetDatabase, seedUser } = await import("./helpers");

async function seedTitles() {
  await prisma.movie.create({ data: { id: "603", title: "Test Movie" } });
  await prisma.show.create({ data: { id: "603", name: "Test Show" } });
}

function makeList(userId = TEST_USER_ID, name = "Weekend") {
  return prisma.list.create({ data: { userId, name } });
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
});

describe("List", () => {
  it("defaults to not tracking separately", async () => {
    const list = await makeList();

    expect(list.trackSeparately).toBe(false);
  });

  it("lets two users each have a list with the same name", async () => {
    const other = await seedUser("other-user");

    await makeList(TEST_USER_ID, "Favourites");
    await makeList(other, "Favourites");

    expect(await prisma.list.count({ where: { name: "Favourites" } })).toBe(2);
  });

  it("is deleted with its user, taking its items", async () => {
    await seedTitles();
    const list = await makeList();
    await prisma.listItem.create({ data: { listId: list.id, movieId: "603" } });

    await prisma.user.delete({ where: { id: TEST_USER_ID } });

    expect(await prisma.list.count()).toBe(0);
    expect(await prisma.listItem.count()).toBe(0);
  });

  it("deletes its items but not the titles", async () => {
    await seedTitles();
    const list = await makeList();
    await prisma.listItem.create({ data: { listId: list.id, movieId: "603" } });
    await prisma.listItem.create({ data: { listId: list.id, showId: "603" } });

    await prisma.list.delete({ where: { id: list.id } });

    expect(await prisma.listItem.count()).toBe(0);
    expect(await prisma.movie.count()).toBe(1);
    expect(await prisma.show.count()).toBe(1);
  });
});

describe("ListItem", () => {
  it("rejects the same movie twice on one list", async () => {
    await seedTitles();
    const list = await makeList();
    await prisma.listItem.create({ data: { listId: list.id, movieId: "603" } });

    const error = await prisma.listItem
      .create({ data: { listId: list.id, movieId: "603" } })
      .catch((e: unknown) => e);

    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it("rejects the same show twice on one list", async () => {
    await seedTitles();
    const list = await makeList();
    await prisma.listItem.create({ data: { listId: list.id, showId: "603" } });

    const error = await prisma.listItem
      .create({ data: { listId: list.id, showId: "603" } })
      .catch((e: unknown) => e);

    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it("puts a movie and a show with the same TMDB id on one list", async () => {
    await seedTitles();
    const list = await makeList();

    await prisma.listItem.create({ data: { listId: list.id, movieId: "603" } });
    await prisma.listItem.create({ data: { listId: list.id, showId: "603" } });

    expect(await prisma.listItem.count({ where: { listId: list.id } })).toBe(2);
  });

  it("allows the same title on several lists", async () => {
    await seedTitles();
    const a = await makeList(TEST_USER_ID, "A");
    const b = await makeList(TEST_USER_ID, "B");

    await prisma.listItem.create({ data: { listId: a.id, movieId: "603" } });
    await prisma.listItem.create({ data: { listId: b.id, movieId: "603" } });

    expect(await prisma.listItem.count()).toBe(2);
  });

  it("is deleted with its movie", async () => {
    await seedTitles();
    const list = await makeList();
    await prisma.listItem.create({ data: { listId: list.id, movieId: "603" } });
    await prisma.listItem.create({ data: { listId: list.id, showId: "603" } });

    await prisma.movie.delete({ where: { id: "603" } });

    const left = await prisma.listItem.findMany();
    expect(left).toHaveLength(1);
    expect(left[0].showId).toBe("603");
  });

  it("is deleted with its show", async () => {
    await seedTitles();
    const list = await makeList();
    await prisma.listItem.create({ data: { listId: list.id, movieId: "603" } });
    await prisma.listItem.create({ data: { listId: list.id, showId: "603" } });

    await prisma.show.delete({ where: { id: "603" } });

    const left = await prisma.listItem.findMany();
    expect(left).toHaveLength(1);
    expect(left[0].movieId).toBe("603");
  });
});

describe("clearAllData", () => {
  it("removes the caller's lists and leaves other users' alone", async () => {
    await seedTitles();
    const other = await seedUser("other-user");
    const mine = await makeList(TEST_USER_ID, "Mine");
    const theirs = await makeList(other, "Theirs");
    await prisma.listItem.create({ data: { listId: mine.id, movieId: "603" } });
    await prisma.listItem.create({ data: { listId: theirs.id, movieId: "603" } });

    const result = await clearAllData();

    expect(result).toEqual({ ok: true });
    const lists = await prisma.list.findMany();
    expect(lists.map((l) => l.id)).toEqual([theirs.id]);
    expect(await prisma.listItem.count()).toBe(1);
  });
});
