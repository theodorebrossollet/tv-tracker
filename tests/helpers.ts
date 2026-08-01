import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";

/**
 * The user everything belongs to unless a test says otherwise.
 *
 * Fixed rather than generated so a test can assert against it without
 * threading an id around, and so `seedShow` has a default owner. Tests about
 * isolation create a second user explicitly — see `seedUser`.
 */
export const TEST_USER_ID = "test-user";

/** Creates an account, and returns its id. */
export async function seedUser(id = TEST_USER_ID) {
  await prisma.user.create({
    data: {
      id,
      // Unique per user, and never used to log in from a test.
      codeHash: createHash("sha256").update(id).digest("hex"),
      nickname: id,
      nicknameKey: id.toLowerCase(),
      passwordHash: "scrypt$1$1$1$00$00",
    },
  });

  return id;
}

/** Clears every table between tests, children first. */
export async function resetDatabase() {
  await prisma.watchedEpisode.deleteMany();
  await prisma.trackedShow.deleteMany();
  await prisma.episode.deleteMany();
  await prisma.show.deleteMany();
  await prisma.settings.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface SeedOptions {
  showId?: string;
  name?: string;
  /** Days from now for each episode; negative is aired, positive upcoming. */
  offsets: number[];
  status?: "watching" | "watchlist" | "paused" | "stopped" | null;
  /** Who tracks it and whose watch marks these are. Defaults to TEST_USER_ID. */
  userId?: string;
  /** Indices into `offsets` that should start out watched. */
  watched?: number[];
  /** TMDB lifecycle, for the "caught up" vs "series finished" distinction. */
  showStatus?: string | null;
}

/** Creates a show with episodes, optionally tracked and partly watched. */
export async function seedShow({
  showId = "101",
  name = "Test Show",
  offsets,
  status = null,
  watched = [],
  showStatus = null,
  userId = TEST_USER_ID,
}: SeedOptions) {
  // The show itself is the shared TMDB cache, so a second user tracking the
  // same show reuses this row rather than creating another.
  await prisma.show.upsert({
    where: { id: showId },
    create: { id: showId, name, status: showStatus },
    update: {},
  });

  const episodeIds: string[] = [];

  for (const [index, offset] of offsets.entries()) {
    const id = `${showId}-e${index + 1}`;
    episodeIds.push(id);

    await prisma.episode.upsert({
      where: { id },
      update: {},
      create: {
        id,
        showId,
        seasonNumber: 1,
        episodeNumber: index + 1,
        name: `Episode ${index + 1}`,
        airDate: new Date(Date.now() + offset * DAY_MS),
        runtime: 45,
      },
    });
  }

  if (status) {
    await prisma.trackedShow.create({ data: { userId, showId, status } });
  }

  for (const index of watched) {
    await prisma.watchedEpisode.create({
      data: { userId, episodeId: episodeIds[index] },
    });
  }

  return { showId, episodeIds };
}

export async function statusOf(showId: string, userId = TEST_USER_ID) {
  const tracked = await prisma.trackedShow.findUnique({
    where: { userId_showId: { userId, showId } },
  });
  return tracked?.status ?? null;
}

export async function watchedCount(showId: string, userId = TEST_USER_ID) {
  return prisma.watchedEpisode.count({
    where: { userId, episode: { showId } },
  });
}

/** Backdates a show's watch history so ordering tests aren't all identical. */
export async function setWatchedAt(
  episodeId: string,
  daysAgo: number,
  userId = TEST_USER_ID,
) {
  await prisma.watchedEpisode.update({
    where: { userId_episodeId: { userId, episodeId } },
    data: { watchedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) },
  });
}
