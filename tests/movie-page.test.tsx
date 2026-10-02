// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  addToWatchlist: vi.fn(async () => ({ ok: true })),
  pauseShow: vi.fn(async () => ({ ok: true })),
  removeShow: vi.fn(async () => ({ ok: true })),
  resumeShow: vi.fn(async () => ({ ok: true })),
  stopShow: vi.fn(async () => ({ ok: true })),
  addMovieToWatchlist: vi.fn(async () => ({ ok: true })),
  setMovieStatus: vi.fn(async () => ({ ok: true })),
  removeMovie: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", () => ({
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "s",
    user: { id: "u1", nickname: "u", hasPassword: true },
  })),
}));
vi.mock("@/app/list-actions", () => ({
  addToList: vi.fn(async () => ({ ok: true })),
  removeFromList: vi.fn(async () => ({ ok: true })),
  createList: vi.fn(async () => ({ ok: true, id: "n" })),
  updateList: vi.fn(),
}));
vi.mock("@/lib/queries", () => ({
  getMovieDetail: vi.fn(),
  getListsForTitle: vi.fn(async () => []),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  describeError: (e: unknown) => ({
    errorMessage: e instanceof Error ? e.message : String(e),
  }),
}));
vi.mock("@/lib/tmdb", () => ({
  getMovieDetails: vi.fn(),
  TmdbError: class TmdbError extends Error {},
}));

const { default: MoviePage, generateMetadata } = await import(
  "@/app/movie/[id]/page"
);
const { getMovieDetail, getListsForTitle } = await import("@/lib/queries");
const { getMovieDetails } = await import("@/lib/tmdb");
const { requireOnboardedSession } = await import("@/lib/auth");
const { logger } = await import("@/lib/logger");

import type { MovieDetail } from "@/lib/queries";

const detailMock = vi.mocked(getMovieDetail);

function movie(over: Partial<MovieDetail> = {}): MovieDetail {
  return {
    id: "603",
    title: "The Matrix",
    posterPath: "/m.jpg",
    overview: "A hacker learns the truth.",
    releaseDate: new Date("1999-03-31T00:00:00Z"),
    runtime: 136,
    genres: "Action, Science Fiction",
    status: null,
    watchedAt: null,
    ...over,
  };
}

async function renderPage(id = "603") {
  render(await MoviePage({ params: Promise.resolve({ id }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("movie page actions", () => {
  it("offers both Add to watchlist and Mark watched when untracked", async () => {
    detailMock.mockResolvedValue(movie({ status: null }));
    await renderPage();

    expect(screen.getByRole("button", { name: /add to watchlist/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /mark watched/i })).toBeTruthy();
  });

  it("offers Mark watched and the status pill on the watchlist", async () => {
    detailMock.mockResolvedValue(movie({ status: "watchlist" }));
    await renderPage();

    expect(screen.getByRole("button", { name: /mark watched/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add to watchlist/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Change status for The Matrix" })
        .textContent,
    ).toContain("Watchlist");
  });

  it("offers neither once watched", async () => {
    detailMock.mockResolvedValue(
      movie({ status: "watched", watchedAt: new Date() }),
    );
    await renderPage();

    expect(screen.queryByRole("button", { name: /mark watched/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add to watchlist/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Change status for The Matrix" })
        .textContent,
    ).toContain("Watched");
  });

  it("offers neither when not interested", async () => {
    detailMock.mockResolvedValue(movie({ status: "not_interested" }));
    await renderPage();

    expect(screen.queryByRole("button", { name: /mark watched/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add to watchlist/i })).toBeNull();
  });
});

describe("movie page add to list", () => {
  it.each([
    ["untracked", null],
    ["watchlist", "watchlist"],
    ["watched", "watched"],
    ["not_interested", "not_interested"],
  ] as const)("renders Add to list when %s", async (_name, status) => {
    detailMock.mockResolvedValue(
      movie({ status, watchedAt: status === "watched" ? new Date() : null }),
    );
    await renderPage();

    expect(screen.getByRole("button", { name: "Add to list" })).toBeTruthy();
    expect(getListsForTitle).toHaveBeenCalledWith("u1", "movie", "603");
  });

  it("still renders the page, without the button, when the lists read fails", async () => {
    detailMock.mockResolvedValue(movie());
    vi.mocked(getListsForTitle).mockRejectedValueOnce(
      new Error('relation "List" does not exist'),
    );
    await renderPage();

    expect(screen.getByRole("heading", { name: "The Matrix" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add to list" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /mark watched/i }),
    ).toBeTruthy();
    expect(logger.warn).toHaveBeenCalledWith("lists.for_title_failed", {
      errorMessage: 'relation "List" does not exist',
    });
  });

  it("does not look up lists for a malformed id", async () => {
    await expect(renderPage("abc")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getListsForTitle).not.toHaveBeenCalled();
  });
});

describe("movie page content", () => {
  it("shows title, year, runtime, genres and overview", async () => {
    detailMock.mockResolvedValue(movie());
    await renderPage();

    expect(screen.getByRole("heading", { name: "The Matrix" })).toBeTruthy();
    expect(
      screen.getByText("1999 · 2h 16m · Action, Science Fiction"),
    ).toBeTruthy();
    expect(screen.getByText("A hacker learns the truth.")).toBeTruthy();
  });

  it("renders cleanly with no poster, date, runtime, genres or overview", async () => {
    detailMock.mockResolvedValue(
      movie({
        posterPath: null,
        releaseDate: null,
        runtime: null,
        genres: null,
        overview: null,
      }),
    );
    await renderPage();

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/NaN|undefined|null|0 min|0m/);
    expect(text).not.toContain("·");
    expect(screen.getByText("No poster")).toBeTruthy();
  });

  it("skips only the missing parts of the meta line", async () => {
    detailMock.mockResolvedValue(movie({ runtime: null }));
    await renderPage();
    expect(screen.getByText("1999 · Action, Science Fiction")).toBeTruthy();
  });
});

describe("movie page id handling", () => {
  it.each(["abc", "1/season/2", "12?x=y", ""])(
    "404s on malformed id %j without touching TMDB or the database",
    async (id) => {
      await expect(renderPage(id)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(getMovieDetail).not.toHaveBeenCalled();
      expect(getMovieDetails).not.toHaveBeenCalled();
    },
  );

  it("404s when the movie doesn't exist", async () => {
    detailMock.mockResolvedValue(null);
    await expect(renderPage("999")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("gates before anything else", async () => {
    vi.mocked(requireOnboardedSession).mockRejectedValueOnce(
      new Error("NEXT_REDIRECT"),
    );
    await expect(renderPage("abc")).rejects.toThrow("NEXT_REDIRECT");
    expect(getMovieDetail).not.toHaveBeenCalled();
  });
});

describe("movie page metadata", () => {
  it("titles the page after the movie", async () => {
    detailMock.mockResolvedValue(movie());
    expect(
      await generateMetadata({ params: Promise.resolve({ id: "603" }) }),
    ).toEqual({ title: "The Matrix · TV Tracker" });
  });

  it("falls back for an unknown or malformed id, and is gated", async () => {
    expect(
      await generateMetadata({ params: Promise.resolve({ id: "abc" }) }),
    ).toEqual({ title: "Movie · TV Tracker" });
    expect(getMovieDetail).not.toHaveBeenCalled();
    expect(requireOnboardedSession).toHaveBeenCalled();

    detailMock.mockResolvedValue(null);
    expect(
      await generateMetadata({ params: Promise.resolve({ id: "999" }) }),
    ).toEqual({ title: "Movie · TV Tracker" });
  });
});
