import { prisma } from "@/lib/prisma";

/** Clears every table between tests, children first. */
export async function resetDatabase() {
  await prisma.watchedEpisode.deleteMany();
  await prisma.trackedShow.deleteMany();
  await prisma.episode.deleteMany();
  await prisma.show.deleteMany();
  await prisma.settings.deleteMany();
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface SeedOptions {
  showId?: string;
  name?: string;
  /** Days from now for each episode; negative is aired, positive upcoming. */
  offsets: number[];
  status?: "watching" | "watchlist" | "paused" | "stopped" | null;
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
}: SeedOptions) {
  await prisma.show.create({ data: { id: showId, name, status: showStatus } });

  const episodeIds: string[] = [];

  for (const [index, offset] of offsets.entries()) {
    const id = `${showId}-e${index + 1}`;
    episodeIds.push(id);

    await prisma.episode.create({
      data: {
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
    await prisma.trackedShow.create({ data: { showId, status } });
  }

  for (const index of watched) {
    await prisma.watchedEpisode.create({
      data: { episodeId: episodeIds[index] },
    });
  }

  return { showId, episodeIds };
}

export async function statusOf(showId: string) {
  const tracked = await prisma.trackedShow.findUnique({ where: { showId } });
  return tracked?.status ?? null;
}

export async function watchedCount(showId: string) {
  return prisma.watchedEpisode.count({ where: { episode: { showId } } });
}

/** Backdates a show's watch history so ordering tests aren't all identical. */
export async function setWatchedAt(episodeId: string, daysAgo: number) {
  await prisma.watchedEpisode.update({
    where: { episodeId },
    data: { watchedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) },
  });
}
