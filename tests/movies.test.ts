import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cacheNewMovie,
  NEW_MOVIES_PER_HOUR,
  NewMovieLimitError,
  syncMovieFromTmdb,
} from "@/lib/movies";
import { prisma } from "@/lib/prisma";
import { getMovieDetails } from "@/lib/tmdb";

import { TEST_USER_ID, resetDatabase, seedUser } from "./helpers";

vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tmdb")>()),
  getMovieDetails: vi.fn(),
}));

const MOVIE_ID = "603";

const details = {
  id: 603,
  title: "The Matrix",
  posterPath: "/matrix.jpg",
  overview: "A hacker learns the truth.",
  releaseDate: new Date("1999-03-31T04:00:00Z"),
  runtime: 136,
  status: "Released",
  genres: "Action, Science Fiction",
};

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
  vi.mocked(getMovieDetails).mockReset();
  vi.mocked(getMovieDetails).mockResolvedValue(details);
});

describe("syncMovieFromTmdb", () => {
  it("creates the row with the mapped fields and its owner", async () => {
    await expect(syncMovieFromTmdb(MOVIE_ID, TEST_USER_ID)).resolves.toEqual({
      title: "The Matrix",
    });

    await expect(
      prisma.movie.findUniqueOrThrow({ where: { id: MOVIE_ID } }),
    ).resolves.toMatchObject({
      title: "The Matrix",
      posterPath: "/matrix.jpg",
      overview: "A hacker learns the truth.",
      releaseDate: details.releaseDate,
      runtime: 136,
      status: "Released",
      genres: "Action, Science Fiction",
      addedById: TEST_USER_ID,
    });
  });

  it("keeps the original addedById and createdAt on a re-sync, and bumps lastSynced", async () => {
    await syncMovieFromTmdb(MOVIE_ID, TEST_USER_ID);
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await prisma.movie.update({
      where: { id: MOVIE_ID },
      data: { createdAt: old, lastSynced: old },
    });
    await seedUser("someone-else");
    vi.mocked(getMovieDetails).mockResolvedValue({ ...details, title: "Matrix" });

    await syncMovieFromTmdb(MOVIE_ID, "someone-else");

    const row = await prisma.movie.findUniqueOrThrow({ where: { id: MOVIE_ID } });
    expect(row.title).toBe("Matrix");
    expect(row.addedById).toBe(TEST_USER_ID);
    expect(row.createdAt).toEqual(old);
    expect(row.lastSynced.getTime()).toBeGreaterThan(old.getTime());
  });
});

describe("the hourly allowance of new movies", () => {
  const seedMovies = (
    count: number,
    { minutesAgo = 5, addedById = TEST_USER_ID } = {},
  ) =>
    prisma.movie.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        id: `${addedById}-owned-${i}`,
        title: "Owned",
        addedById,
        createdAt: new Date(Date.now() - minutesAgo * 60 * 1000),
      })),
    });

  it("refuses at the limit, without calling TMDB", async () => {
    await seedMovies(NEW_MOVIES_PER_HOUR);

    await expect(cacheNewMovie(MOVIE_ID, TEST_USER_ID)).rejects.toBeInstanceOf(
      NewMovieLimitError,
    );
    expect(getMovieDetails).not.toHaveBeenCalled();
  });

  it("allows one more just under the limit, and records the owner", async () => {
    await seedMovies(NEW_MOVIES_PER_HOUR - 1);

    await expect(cacheNewMovie(MOVIE_ID, TEST_USER_ID)).resolves.toEqual({
      title: "The Matrix",
    });
    await expect(
      prisma.movie.findUniqueOrThrow({ where: { id: MOVIE_ID } }),
    ).resolves.toMatchObject({ addedById: TEST_USER_ID });
  });

  it("does not count shows cached by the same account", async () => {
    await prisma.show.createMany({
      data: Array.from({ length: NEW_MOVIES_PER_HOUR }, (_, i) => ({
        id: `show-${i}`,
        name: "Show",
        addedById: TEST_USER_ID,
        createdAt: new Date(),
      })),
    });

    await expect(cacheNewMovie(MOVIE_ID, TEST_USER_ID)).resolves.toBeDefined();
  });

  it("does not count movies cached by another account", async () => {
    await seedUser("someone-else");
    await seedMovies(NEW_MOVIES_PER_HOUR, { addedById: "someone-else" });

    await expect(cacheNewMovie(MOVIE_ID, TEST_USER_ID)).resolves.toBeDefined();
  });

  it("does not count movies cached more than an hour ago", async () => {
    await seedMovies(NEW_MOVIES_PER_HOUR, { minutesAgo: 61 });

    await expect(cacheNewMovie(MOVIE_ID, TEST_USER_ID)).resolves.toBeDefined();
  });
});
