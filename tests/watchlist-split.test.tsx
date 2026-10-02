// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  addToWatchlist: vi.fn(async () => ({ ok: true })),
  pauseShow: vi.fn(async () => ({ ok: true })),
  removeShow: vi.fn(async () => ({ ok: true })),
  resumeShow: vi.fn(async () => ({ ok: true })),
  stopShow: vi.fn(async () => ({ ok: true })),
  setMovieStatus: vi.fn(async () => ({ ok: true })),
  removeMovie: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Both reach for providers the screen test has no reason to mount.
vi.mock("@/components/search-icon-button", () => ({
  SearchIconButton: () => null,
}));
vi.mock("@/components/find-show-button", () => ({
  FindShowButton: ({ label = "Find a show" }: { label?: string }) => (
    <button type="button">{label}</button>
  ),
}));
vi.mock("@/components/pull-to-refresh-page", () => ({
  PullToRefreshPage: () => null,
}));

const { LibraryScreen } = await import("@/components/library-screen");

import type {
  MovieBuckets,
  MovieSummary,
  ShowBuckets,
  TrackedShowSummary,
} from "@/lib/queries";

afterEach(cleanup);

const emptyShows: ShowBuckets = {
  watching: [],
  watchlist: [],
  paused: [],
  caughtUp: [],
  finished: [],
  stopped: [],
};
const emptyMovies: MovieBuckets = { watchlist: [], watched: [], notInterested: [] };

function show(over: Partial<TrackedShowSummary>): TrackedShowSummary {
  return {
    showId: "1",
    name: "Show",
    posterPath: null,
    status: "watchlist",
    airedCount: 0,
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

function movie(over: Partial<MovieSummary>): MovieSummary {
  return {
    movieId: "1",
    title: "Film",
    posterPath: null,
    releaseDate: null,
    runtime: null,
    status: "watchlist",
    watchedAt: null,
    addedAt: new Date("2026-01-01T00:00:00Z"),
    rating: null,
    ...over,
  };
}

function renderShows(watchlist: TrackedShowSummary[]) {
  return render(
    <LibraryScreen
      segment="watchlist"
      searchParams={{}}
      data={{ type: "shows", buckets: { ...emptyShows, watchlist } }}
    />,
  );
}

function renderMovies(watchlist: MovieSummary[]) {
  return render(
    <LibraryScreen
      segment="watchlist"
      searchParams={{ type: "movies" }}
      data={{ type: "movies", buckets: { ...emptyMovies, watchlist } }}
    />,
  );
}

describe("shows watchlist split", () => {
  it("separates shows with aired episodes from ones that haven't started", () => {
    renderShows([
      show({ showId: "1", name: "Out Now", airedCount: 8 }),
      show({ showId: "2", name: "Coming Soon", airedCount: 0 }),
    ]);

    const section = screen.getByRole("heading", { name: "Not out yet" })
      .parentElement!;

    expect(within(section).getByText("Coming Soon")).toBeTruthy();
    expect(within(section).getByText("Not aired yet")).toBeTruthy();
    expect(within(section).queryByText("Out Now")).toBeNull();
    // The ready one sits above, outside the section, with its count.
    expect(screen.getByText("Out Now")).toBeTruthy();
    expect(screen.getByText("8 episodes available")).toBeTruthy();
  });

  it("has no Not out yet section when everything has aired", () => {
    renderShows([show({ airedCount: 3 })]);

    expect(screen.queryByRole("heading", { name: "Not out yet" })).toBeNull();
  });

  it("says so when nothing on the watchlist can be started", () => {
    renderShows([show({ airedCount: 0 })]);

    expect(screen.getByText("Nothing on your watchlist has aired yet.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Not out yet" })).toBeTruthy();
  });

  it("still shows the empty state for an empty watchlist", () => {
    renderShows([]);

    expect(screen.getByText("Watchlist is empty")).toBeTruthy();
  });
});

describe("movies watchlist split", () => {
  it("puts future and undated movies under Not released yet", () => {
    renderMovies([
      movie({ movieId: "1", title: "Old Film", releaseDate: new Date("1995-12-15T00:00:00Z") }),
      movie({ movieId: "2", title: "Next Year", releaseDate: new Date("2999-01-01T00:00:00Z") }),
      movie({ movieId: "3", title: "No Date", releaseDate: null }),
    ]);

    const section = screen.getByRole("heading", { name: "Not released yet" })
      .parentElement!;

    expect(within(section).getByText("Next Year")).toBeTruthy();
    expect(within(section).getByText("No Date")).toBeTruthy();
    expect(within(section).queryByText("Old Film")).toBeNull();
    expect(screen.getByText("Old Film")).toBeTruthy();
  });

  it("has no extra section when everything is out", () => {
    renderMovies([movie({ releaseDate: new Date("1995-12-15T00:00:00Z") })]);

    expect(screen.queryByRole("heading", { name: "Not released yet" })).toBeNull();
  });
});
