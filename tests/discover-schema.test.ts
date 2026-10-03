import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { resetDatabase, seedUser, TEST_USER_ID } from "./helpers";

const OTHER = "other";

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
});

describe("DismissedSuggestion table", () => {
  it("rejects a duplicate (user, kind, tmdbId)", async () => {
    const data = { userId: TEST_USER_ID, kind: "movie", tmdbId: "603" };
    await prisma.dismissedSuggestion.create({ data });

    await expect(prisma.dismissedSuggestion.create({ data })).rejects.toThrow();
  });

  it("allows the same tmdbId for the other kind and for another user", async () => {
    await seedUser(OTHER);
    await prisma.dismissedSuggestion.create({
      data: { userId: TEST_USER_ID, kind: "movie", tmdbId: "603" },
    });

    await prisma.dismissedSuggestion.create({
      data: { userId: TEST_USER_ID, kind: "show", tmdbId: "603" },
    });
    await prisma.dismissedSuggestion.create({
      data: { userId: OTHER, kind: "movie", tmdbId: "603" },
    });

    expect(await prisma.dismissedSuggestion.count()).toBe(3);
  });

  it("is deleted with its user", async () => {
    await seedUser(OTHER);
    await prisma.dismissedSuggestion.createMany({
      data: [
        { userId: TEST_USER_ID, kind: "movie", tmdbId: "1" },
        { userId: OTHER, kind: "movie", tmdbId: "1" },
      ],
    });

    await prisma.user.delete({ where: { id: TEST_USER_ID } });

    const rows = await prisma.dismissedSuggestion.findMany();
    expect(rows.map((r) => r.userId)).toEqual([OTHER]);
  });
});
