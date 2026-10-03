// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  addToWatchlist: vi.fn(),
  removeShow: vi.fn(),
  pauseShow: vi.fn(),
  resumeShow: vi.fn(),
  stopShow: vi.fn(),
  setMovieStatus: vi.fn(),
  removeMovie: vi.fn(),
}));
vi.mock("@/app/view-actions", () => ({ setViewMode: vi.fn(async () => ({ ok: true })) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/components/search-icon-button", () => ({ SearchIconButton: () => null }));
vi.mock("@/components/find-show-button", () => ({ FindShowButton: () => null }));
vi.mock("@/components/pull-to-refresh-page", () => ({ PullToRefreshPage: () => null }));

const { LibraryScreen } = await import("@/components/library-screen");
import type { MovieBuckets, MovieSummary, ShowBuckets, TrackedShowSummary } from "@/lib/queries";

afterEach(cleanup);

const noShows: ShowBuckets = { watching: [], watchlist: [], paused: [], caughtUp: [], finished: [], stopped: [] };
const noMovies: MovieBuckets = { watchlist: [], watched: [], notInterested: [] };

function show(over: Partial<TrackedShowSummary> = {}): TrackedShowSummary {
  return {
    showId: "1",
    name: "Severance",
    posterPath: "/s.jpg",
    status: "watchlist",
    airedCount: 10,
    watchedCount: 0,
    fullyWatched: false,
    showStatus: "Returning Series",
    lastWatchedAt: null,
    addedAt: new Date("2026-01-01T00:00:00Z"),
    ratingAverage: null,
    nextUnwatched: null,
    ...over,
  };
}
function movie(over: Partial<MovieSummary> = {}): MovieSummary {
  return {
    movieId: "1",
    title: "Heat",
    posterPath: "/h.jpg",
    releaseDate: new Date("1995-12-15T00:00:00Z"),
    runtime: 170,
    status: "watchlist",
    watchedAt: null,
    addedAt: new Date("2026-01-01T00:00:00Z"),
    rating: null,
    ...over,
  };
}

function renderShows(
  segment: "watchlist" | "archive",
  buckets: Partial<ShowBuckets>,
  view?: "rows" | "posters",
  searchParams: Record<string, string> = {},
) {
  return render(
    <LibraryScreen
      segment={segment}
      searchParams={searchParams}
      data={{ type: "shows", buckets: { ...noShows, ...buckets } }}
      view={view}
    />,
  );
}
function renderMovies(
  segment: "watchlist" | "archive",
  buckets: Partial<MovieBuckets>,
  view?: "rows" | "posters",
) {
  return render(
    <LibraryScreen
      segment={segment}
      searchParams={{ type: "movies" }}
      data={{ type: "movies", buckets: { ...noMovies, ...buckets } }}
      view={view}
    />,
  );
}

describe("Library in the posters view", () => {
  it("puts the toggle in the header and defaults to rows", () => {
    renderShows("watchlist", { watchlist: [show()] });
    const header = screen.getByRole("heading", { name: "Library" }).parentElement!;
    expect(within(header).getByRole("button", { name: "Rows view" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Change status for Severance/ })).toBeTruthy();
  });

  it("shows watchlist shows as poster links with no status menu", () => {
    renderShows("watchlist", { watchlist: [show(), show({ showId: "2", name: "Dark" })] }, "posters");

    expect(screen.getByRole("link", { name: "Severance" }).getAttribute("href")).toBe("/show/1");
    expect(screen.getByRole("link", { name: "Dark" }).getAttribute("href")).toBe("/show/2");
    expect(screen.queryByRole("button", { name: /Change status/ })).toBeNull();
    expect(screen.queryByRole("img", { name: "Movie" })).toBeNull();
  });

  it("keeps each section's heading and description, and its rating star", () => {
    renderShows(
      "watchlist",
      { watchlist: [show({ ratingAverage: 7.4 })], paused: [show({ showId: "9", name: "Paused one" })] },
      "posters",
    );

    expect(screen.getByRole("heading", { name: "Paused" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Average rating 7.4 out of 10" })).toBeTruthy();
  });

  it("checks finished shows only, and quiets the sunken sections", () => {
    renderShows(
      "archive",
      {
        caughtUp: [show({ showId: "3", name: "Caught up show" })],
        finished: [show({ showId: "4", name: "Done show", fullyWatched: true })],
        stopped: [show({ showId: "5", name: "Stopped show" })],
      },
      "posters",
    );

    expect(screen.getAllByRole("img", { name: "Seen" })).toHaveLength(1);
    const done = screen.getByRole("link", { name: "Done show" }).closest("li")!;
    expect(within(done).getByRole("img", { name: "Seen" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Stopped show" }).closest("li")!.className).toContain("opacity-70");
    expect(screen.getByRole("link", { name: "Done show" }).closest("li")!.className).not.toContain("opacity-70");
  });

  it("keeps 'show more' working per section", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      show({ showId: String(100 + i), name: `Title ${i}` }),
    );
    renderShows("watchlist", { watchlist: many }, "posters");

    expect(screen.getAllByRole("link", { name: /^Title \d+$/ })).toHaveLength(10);
    expect(screen.getByRole("link", { name: /^Show 2 more/ })).toBeTruthy();
  });

  it("renders movies as posters, with a check on watched ones and a rating", () => {
    renderMovies(
      "archive",
      { watched: [movie({ status: "watched", rating: 9 })], notInterested: [movie({ movieId: "2", title: "Skipped", status: "not_interested" })] },
      "posters",
    );

    expect(screen.getByRole("link", { name: "Heat" }).getAttribute("href")).toBe("/movie/1");
    const heat = screen.getByRole("link", { name: "Heat" }).closest("li")!;
    expect(within(heat).getByRole("img", { name: "Seen" })).toBeTruthy();
    expect(within(heat).getByRole("img", { name: "Rated 9 out of 10" })).toBeTruthy();
    const skipped = screen.getByRole("link", { name: "Skipped" }).closest("li")!;
    expect(within(skipped).queryByRole("img", { name: "Seen" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Change status/ })).toBeNull();
  });

  it("leaves the rows view untouched", () => {
    renderMovies("watchlist", { watchlist: [movie()] }, "rows");
    expect(screen.getByRole("button", { name: /Change status for Heat/ })).toBeTruthy();
  });

  it("never prints NaN or undefined", () => {
    const { container } = renderShows("watchlist", { watchlist: [show({ posterPath: null })] }, "posters");
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });
});
