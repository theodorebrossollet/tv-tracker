// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@/app/rewatch-actions", () => ({
  watchMovieAgain: vi.fn(async () => ({ ok: true })),
  startShowOver: vi.fn(async () => ({ ok: true })),
  resetMovieHistory: vi.fn(async () => ({ ok: true })),
  resetShowHistory: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/rating-actions", () => ({
  rateMovie: vi.fn(async () => ({ ok: true })),
  rateEpisode: vi.fn(async () => ({ ok: true })),
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
    rating: null,
    pastWatches: [],
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

describe("movie page rating", () => {
  it("shows the stored rating pressed once watched", async () => {
    detailMock.mockResolvedValue(
      movie({ status: "watched", watchedAt: new Date(), rating: 8 }),
    );
    await renderPage();

    expect(screen.getByText("Your rating", { selector: "h2" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Rate 8 out of 10" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Rate 7 out of 10" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("shows the strip with nothing pressed when watched but unrated", async () => {
    detailMock.mockResolvedValue(
      movie({ status: "watched", watchedAt: new Date(), rating: null }),
    );
    await renderPage();

    const steps = screen.getAllByRole("button", { name: /^Rate \d+ out of 10$/ });
    expect(steps).toHaveLength(10);
    expect(steps.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(
      true,
    );
  });

  it.each([
    ["untracked", null],
    ["watchlist", "watchlist"],
    ["not_interested", "not_interested"],
  ] as const)("renders no strip when %s", async (_name, status) => {
    detailMock.mockResolvedValue(movie({ status }));
    await renderPage();

    expect(screen.queryByText("Your rating")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Rate \d+ out of 10$/ })).toBeNull();
  });
});

describe("movie page rewatch", () => {
  it("offers Watch again only for a watched movie", async () => {
    detailMock.mockResolvedValue(
      movie({ status: "watched", watchedAt: new Date(), rating: 8 }),
    );
    await renderPage();
    expect(screen.getByRole("button", { name: "Watch again" })).toBeTruthy();
  });

  it.each([
    ["untracked", null],
    ["watchlist", "watchlist"],
    ["not_interested", "not_interested"],
  ] as const)("does not offer Watch again when %s", async (_name, status) => {
    detailMock.mockResolvedValue(movie({ status }));
    await renderPage();
    expect(screen.queryByRole("button", { name: "Watch again" })).toBeNull();
  });

  it("lists past watches below the rating section", async () => {
    detailMock.mockResolvedValue(
      movie({
        status: "watched",
        watchedAt: new Date(),
        pastWatches: [
          { watchedAt: new Date("2026-03-03T17:00:00Z"), rating: 8 },
          { watchedAt: new Date("2025-01-02T17:00:00Z"), rating: null },
        ],
      }),
    );
    await renderPage();

    const heading = screen.getByText("Past watches", { selector: "h2" });
    const rating = screen.getByText("Your rating", { selector: "h2" });
    expect(
      rating.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders no Past watches when the history is unavailable or empty", async () => {
    for (const pastWatches of [null, []]) {
      detailMock.mockResolvedValue(
        movie({ status: "watched", watchedAt: new Date(), pastWatches }),
      );
      await renderPage();
      expect(screen.queryByText("Past watches")).toBeNull();
      expect(screen.getByRole("heading", { name: "The Matrix" })).toBeTruthy();
      cleanup();
    }
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

describe("movie page reset history", () => {
  const past = { watchedAt: new Date("2025-01-02T17:00:00Z"), rating: 7 };
  const pill = () =>
    screen.queryByRole("button", { name: "Change status for The Matrix" });
  const openPill = () => fireEvent.click(pill()!);

  it("renders the status pill for an untracked movie with past watches, with the Reset row", async () => {
    detailMock.mockResolvedValue(movie({ status: null, pastWatches: [past] }));
    await renderPage();

    expect(pill()).toBeTruthy();
    expect(pill()!.textContent).toContain("Not tracked");
    // The page's own buttons are still there.
    expect(screen.getByRole("button", { name: /add to watchlist/i })).toBeTruthy();

    openPill();
    fireEvent.click(screen.getByRole("button", { name: /Reset history/ }));
    expect(
      screen.getByText(
        "This permanently deletes your watch history and ratings for this movie.",
      ),
    ).toBeTruthy();
  });

  it("renders no pill for an untracked movie without past watches", async () => {
    detailMock.mockResolvedValue(movie({ status: null, pastWatches: [] }));
    await renderPage();
    expect(pill()).toBeNull();

    cleanup();
    detailMock.mockResolvedValue(movie({ status: null, pastWatches: null }));
    await renderPage();
    expect(pill()).toBeNull();
  });

  it("offers the Reset row for a watched movie, with the watchlist sentence", async () => {
    detailMock.mockResolvedValue(
      movie({ status: "watched", watchedAt: new Date(), pastWatches: [] }),
    );
    await renderPage();

    openPill();
    fireEvent.click(screen.getByRole("button", { name: /Reset history/ }));
    expect(
      screen.getByText(/It goes back to your watchlist\./),
    ).toBeTruthy();
  });

  it("offers the Reset row for a watched movie whose past watches are unreadable", async () => {
    detailMock.mockResolvedValue(
      movie({ status: "watched", watchedAt: new Date(), pastWatches: null }),
    );
    await renderPage();

    openPill();
    expect(screen.getByRole("button", { name: /Reset history/ })).toBeTruthy();
  });

  it("offers the Reset row for a watchlist movie with past watches, without the watchlist sentence", async () => {
    detailMock.mockResolvedValue(
      movie({ status: "watchlist", pastWatches: [past] }),
    );
    await renderPage();

    openPill();
    fireEvent.click(screen.getByRole("button", { name: /Reset history/ }));
    expect(screen.queryByText(/goes back to your watchlist/)).toBeNull();
  });

  it("offers no Reset row when there is nothing to reset", async () => {
    detailMock.mockResolvedValue(movie({ status: "watchlist", pastWatches: [] }));
    await renderPage();

    openPill();
    expect(screen.queryByText(/Reset history/)).toBeNull();
  });
});
