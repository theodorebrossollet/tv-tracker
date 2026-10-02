import { beforeEach, describe, expect, it, vi } from "vitest";

// Same doubles as movie-actions.test.ts: no request scope for revalidatePath,
// and a stubbed session that individual tests can point at another account.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "test-session",
    user: { id: "test-user", nickname: "test-user", hasPassword: true },
  })),
}));

const { createList, updateList, deleteList } = await import(
  "@/app/list-actions"
);
const { requireOnboardedSession } = await import("@/lib/auth");
const { MAX_LISTS, LIST_NAME_MAX } = await import("@/lib/lists");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedUser, TEST_USER_ID } = await import("./helpers");

const OTHER = "other";

function actAs(id: string) {
  vi.mocked(requireOnboardedSession).mockImplementation(
    async () =>
      ({
        sessionId: "s",
        user: { id, nickname: id, hasPassword: true },
      }) as never,
  );
}

async function listCount(userId = TEST_USER_ID) {
  return prisma.list.count({ where: { userId } });
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
  actAs(TEST_USER_ID);
});

// ---------------------------------------------------------------------------
// Create, rename, delete
// ---------------------------------------------------------------------------

describe("createList", () => {
  it("trims the name and stores the flag", async () => {
    const result = await createList("  Date night  ", true);

    expect(result.ok).toBe(true);
    const row = await prisma.list.findUnique({ where: { id: result.id! } });
    expect(row).toMatchObject({
      userId: TEST_USER_ID,
      name: "Date night",
      trackSeparately: true,
    });

    const second = await createList("Solo", false);
    expect(
      (await prisma.list.findUnique({ where: { id: second.id! } }))
        ?.trackSeparately,
    ).toBe(false);
  });

  it("refuses an empty, blank, over-long or non-string name", async () => {
    for (const bad of ["", "   ", "x".repeat(LIST_NAME_MAX + 1), 5, null]) {
      const result = await createList(bad as never, false);
      expect(result.ok).toBe(false);
      expect(result.id).toBeUndefined();
    }
    expect(await listCount()).toBe(0);
  });

  it("refuses a non-boolean trackSeparately", async () => {
    for (const bad of ["true", 1, null, undefined]) {
      expect(await createList("A", bad as never)).toEqual({
        ok: false,
        error: "That change isn't available.",
      });
    }
    expect(await listCount()).toBe(0);
  });

  it("allows the 50th list and refuses the 51st", async () => {
    await prisma.list.createMany({
      data: Array.from({ length: MAX_LISTS - 1 }, (_, i) => ({
        userId: TEST_USER_ID,
        name: `L${i}`,
      })),
    });

    expect((await createList("Fiftieth", false)).ok).toBe(true);
    expect(await listCount()).toBe(MAX_LISTS);

    const result = await createList("Fifty-first", false);
    expect(result).toEqual({
      ok: false,
      error: "You've reached the limit of 50 lists.",
    });
    expect(await listCount()).toBe(MAX_LISTS);
  });

  it("counts the limit per account", async () => {
    await seedUser(OTHER);
    await prisma.list.createMany({
      data: Array.from({ length: MAX_LISTS }, (_, i) => ({
        userId: OTHER,
        name: `L${i}`,
      })),
    });

    expect((await createList("Mine", false)).ok).toBe(true);
  });
});

describe("updateList", () => {
  it("renames the list and flips the flag", async () => {
    const { id } = await createList("Old", false);

    expect(
      await updateList(id!, { name: "  New  ", trackSeparately: true }),
    ).toEqual({ ok: true });

    expect(await prisma.list.findUnique({ where: { id: id! } })).toMatchObject({
      name: "New",
      trackSeparately: true,
    });
  });

  it("refuses bad input and leaves the row alone", async () => {
    const { id } = await createList("Keep", false);

    for (const changes of [
      { name: "", trackSeparately: false },
      { name: "x".repeat(LIST_NAME_MAX + 1), trackSeparately: false },
      { name: "Ok", trackSeparately: "yes" },
      null,
    ]) {
      expect((await updateList(id!, changes as never)).ok).toBe(false);
    }
    expect((await updateList(5 as never, { name: "Ok", trackSeparately: false })).ok).toBe(false);
    expect((await updateList("", { name: "Ok", trackSeparately: false })).ok).toBe(false);

    expect(await prisma.list.findUnique({ where: { id: id! } })).toMatchObject({
      name: "Keep",
      trackSeparately: false,
    });
  });

  it("refuses an unknown id", async () => {
    expect(
      await updateList("nope", { name: "X", trackSeparately: false }),
    ).toEqual({ ok: false, error: "List not found." });
  });

  it("refuses another user's list and leaves it unchanged", async () => {
    await seedUser(OTHER);
    const theirs = await prisma.list.create({
      data: { userId: OTHER, name: "Theirs" },
    });

    expect(
      await updateList(theirs.id, { name: "Mine now", trackSeparately: true }),
    ).toEqual({ ok: false, error: "List not found." });

    expect(await prisma.list.findUnique({ where: { id: theirs.id } })).toMatchObject({
      name: "Theirs",
      trackSeparately: false,
    });
  });

  it("keeps every item's watchedAt when the flag is flipped off and on", async () => {
    const { id } = await createList("Together", true);
    const when = new Date("2026-01-02T03:04:05.000Z");
    await prisma.movie.create({ data: { id: "603", title: "Movie 603" } });
    await prisma.listItem.create({
      data: { listId: id!, movieId: "603", watchedAt: when },
    });

    await updateList(id!, { name: "Together", trackSeparately: false });
    await updateList(id!, { name: "Together", trackSeparately: true });

    const item = await prisma.listItem.findFirst({ where: { listId: id! } });
    expect(item?.watchedAt?.toISOString()).toBe(when.toISOString());
  });
});

describe("deleteList", () => {
  it("removes the list and its items but not the titles or Library tracking", async () => {
    const { id } = await createList("Doomed", false);
    await prisma.movie.create({ data: { id: "603", title: "Movie 603" } });
    await prisma.trackedMovie.create({
      data: { userId: TEST_USER_ID, movieId: "603", status: "watchlist" },
    });
    await prisma.listItem.create({ data: { listId: id!, movieId: "603" } });

    expect(await deleteList(id!)).toEqual({ ok: true });

    expect(await prisma.list.count()).toBe(0);
    expect(await prisma.listItem.count()).toBe(0);
    expect(await prisma.movie.count({ where: { id: "603" } })).toBe(1);
    expect(await prisma.trackedMovie.count({ where: { movieId: "603" } })).toBe(1);
  });

  it("refuses an unknown id or a non-string", async () => {
    expect(await deleteList("nope")).toEqual({
      ok: false,
      error: "List not found.",
    });
    expect((await deleteList(5 as never)).ok).toBe(false);
    expect((await deleteList("")).ok).toBe(false);
  });

  it("refuses another user's list and leaves it, with its items", async () => {
    await seedUser(OTHER);
    const theirs = await prisma.list.create({
      data: { userId: OTHER, name: "Theirs" },
    });
    await prisma.movie.create({ data: { id: "603", title: "Movie 603" } });
    await prisma.listItem.create({
      data: { listId: theirs.id, movieId: "603" },
    });

    expect(await deleteList(theirs.id)).toEqual({
      ok: false,
      error: "List not found.",
    });

    expect(await listCount(OTHER)).toBe(1);
    expect(await prisma.listItem.count({ where: { listId: theirs.id } })).toBe(1);
  });
});
