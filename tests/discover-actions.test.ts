import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const session = vi.hoisted(() => ({ userId: "test-user" }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "test-session",
    user: { id: session.userId, nickname: session.userId, hasPassword: true },
  })),
}));

const { dismissSuggestion, resetDismissedSuggestions } = await import(
  "@/app/discover-actions"
);
const { clearAllData } = await import("@/app/actions");
const { MAX_DISMISSED } = await import("@/lib/discover-limits");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedUser, TEST_USER_ID } = await import("./helpers");

const OTHER = "other";

function countFor(userId = TEST_USER_ID) {
  return prisma.dismissedSuggestion.count({ where: { userId } });
}

beforeEach(async () => {
  session.userId = TEST_USER_ID;
  await resetDatabase();
  await seedUser();
});

describe("dismissSuggestion", () => {
  it("creates the row", async () => {
    expect(await dismissSuggestion("movie", "603")).toEqual({ ok: true });

    const rows = await prisma.dismissedSuggestion.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: TEST_USER_ID,
      kind: "movie",
      tmdbId: "603",
    });
  });

  it("is a no-op the second time", async () => {
    await dismissSuggestion("show", "1399");

    expect(await dismissSuggestion("show", "1399")).toEqual({ ok: true });
    expect(await countFor()).toBe(1);
  });

  it("refuses an invalid kind", async () => {
    expect((await dismissSuggestion("tv", "1399")).ok).toBe(false);
    expect((await dismissSuggestion("", "1399")).ok).toBe(false);
    expect(await countFor()).toBe(0);
  });

  it("refuses a non-digit or over-long id", async () => {
    expect((await dismissSuggestion("movie", "603/x")).ok).toBe(false);
    expect((await dismissSuggestion("movie", "")).ok).toBe(false);
    expect((await dismissSuggestion("show", "12ab")).ok).toBe(false);
    expect((await dismissSuggestion("movie", "1".repeat(13))).ok).toBe(false);
    expect(await countFor()).toBe(0);
  });

  it("refuses the row past the limit", async () => {
    await prisma.dismissedSuggestion.createMany({
      data: Array.from({ length: MAX_DISMISSED }, (_, i) => ({
        userId: TEST_USER_ID,
        kind: "movie",
        tmdbId: String(i + 1),
      })),
    });

    const result = await dismissSuggestion("movie", "999999");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Too many hidden suggestions/);
    expect(await countFor()).toBe(MAX_DISMISSED);
  });

  it("leaves another account's rows untouched", async () => {
    await seedUser(OTHER);
    await prisma.dismissedSuggestion.create({
      data: { userId: OTHER, kind: "movie", tmdbId: "603" },
    });

    await dismissSuggestion("movie", "603");

    expect(await countFor(OTHER)).toBe(1);
    expect(await countFor()).toBe(1);
  });
});

describe("resetDismissedSuggestions", () => {
  it("deletes only the caller's rows and returns the count", async () => {
    await seedUser(OTHER);
    await prisma.dismissedSuggestion.createMany({
      data: [
        { userId: TEST_USER_ID, kind: "movie", tmdbId: "1" },
        { userId: TEST_USER_ID, kind: "show", tmdbId: "2" },
        { userId: OTHER, kind: "movie", tmdbId: "1" },
      ],
    });

    expect(await resetDismissedSuggestions()).toEqual({ ok: true, count: 2 });
    expect(await countFor()).toBe(0);
    expect(await countFor(OTHER)).toBe(1);
  });

  it("returns 0 when there is nothing to reset", async () => {
    expect(await resetDismissedSuggestions()).toEqual({ ok: true, count: 0 });
  });
});

describe("clearAllData", () => {
  it("removes the caller's dismissed suggestions only", async () => {
    await seedUser(OTHER);
    await prisma.dismissedSuggestion.createMany({
      data: [
        { userId: TEST_USER_ID, kind: "movie", tmdbId: "1" },
        { userId: OTHER, kind: "movie", tmdbId: "1" },
      ],
    });

    expect(await clearAllData()).toEqual({ ok: true });
    expect(await countFor()).toBe(0);
    expect(await countFor(OTHER)).toBe(1);
  });
});
