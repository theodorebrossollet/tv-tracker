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
  FindShowButton: () => null,
}));
vi.mock("@/components/pull-to-refresh-page", () => ({
  PullToRefreshPage: () => null,
}));

const { LibraryScreen } = await import("@/components/library-screen");

import type { MovieBuckets, MovieSummary, ShowBuckets } from "@/lib/queries";

afterEach(cleanup);

const emptyShows: ShowBuckets = {
  watching: [],
  watchlist: [],
  paused: [],
  caughtUp: [],
  finished: [],
  stopped: [],
};

function movie(over: Partial<MovieSummary> = {}): MovieSummary {
  return {
    movieId: "1",
    title: "Heat",
    posterPath: null,
    releaseDate: new Date("1995-12-15T00:00:00Z"),
    runtime: 170,
    status: "watchlist",
    watchedAt: null,
    addedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

const emptyMovies: MovieBuckets = {
  watchlist: [],
  watched: [],
  notInterested: [],
};

function renderMovies(
  segment: "watchlist" | "archive",
  buckets: Partial<MovieBuckets> = {},
  searchParams: Record<string, string | string[] | undefined> = {
    type: "movies",
  },
) {
  return render(
    <LibraryScreen
      segment={segment}
      searchParams={searchParams}
      data={{ type: "movies", buckets: { ...emptyMovies, ...buckets } }}
    />,
  );
}

const hrefOf = (name: string) =>
  screen.getByRole("link", { name }).getAttribute("href");

describe("the Shows/Movies switch and segments", () => {
  it("links the switch to the bare segment and ?type=movies", () => {
    renderMovies("watchlist");

    expect(hrefOf("Shows")).toBe("/watchlist");
    expect(hrefOf("Movies")).toBe("/watchlist?type=movies");
    expect(
      screen.getByRole("link", { name: "Movies" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("keeps type=movies on the segment links and drops other params", () => {
    renderMovies(
      "archive",
      {},
      { type: "movies", finished: "30", movieWatched: "20" },
    );

    expect(hrefOf("Watchlist")).toBe("/watchlist?type=movies");
    expect(hrefOf("Archive")).toBe("/archive?type=movies");
    expect(hrefOf("Shows")).toBe("/archive");
  });

  it("leaves the segment links bare in the Shows view", () => {
    render(
      <LibraryScreen
        segment="watchlist"
        searchParams={{}}
        data={{ type: "shows", buckets: emptyShows }}
      />,
    );

    expect(hrefOf("Watchlist")).toBe("/watchlist");
    expect(hrefOf("Archive")).toBe("/archive");
    expect(hrefOf("Movies")).toBe("/watchlist?type=movies");
    expect(
      screen.getByRole("link", { name: "Shows" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});

describe("movie lists", () => {
  it("shows year and runtime for a watchlist movie", () => {
    renderMovies("watchlist", { watchlist: [movie()] });

    expect(
      screen.getByRole("link", { name: "Heat" }).getAttribute("href"),
    ).toBe("/movie/1");
    expect(screen.getByText("1995 · 170 min")).toBeTruthy();
  });

  it("shows the watched date for watched movies, under Watched then Not interested", () => {
    renderMovies("archive", {
      watched: [
        movie({
          movieId: "2",
          title: "Ran",
          status: "watched",
          watchedAt: new Date("2026-03-14T12:00:00Z"),
        }),
      ],
      notInterested: [
        movie({ movieId: "3", title: "Cats", status: "not_interested" }),
      ],
    });

    expect(screen.getByText("Watched 14 Mar 2026")).toBeTruthy();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Watched", "Not interested"]);
    expect(screen.getByText("1995 · 170 min")).toBeTruthy();
  });

  it("renders empty states", () => {
    renderMovies("watchlist");
    expect(screen.getByText("Watchlist is empty")).toBeTruthy();
    cleanup();
    renderMovies("archive");
    expect(screen.getByText("Nothing archived yet")).toBeTruthy();
  });

  it.each([
    ["no date, no runtime", { releaseDate: null, runtime: null }, ""],
    ["no date", { releaseDate: null }, "170 min"],
    ["no runtime", { runtime: null }, "1995"],
    ["zero runtime", { runtime: 0 }, "1995"],
  ])("renders cleanly with %s", (_, over, expected) => {
    const { container } = renderMovies("watchlist", {
      watchlist: [movie(over)],
    });
    const text = container.textContent ?? "";

    for (const bad of ["NaN", "0 min", "undefined", "null", "·  ", " · ·"]) {
      if (bad === "0 min" && expected.includes("170 min")) continue;
      expect(text).not.toContain(bad);
    }
    expect(text).not.toMatch(/·\s*$|^\s*·|·\s*·/);
    const row = screen.getByRole("link", { name: "Heat" }).closest("li")!;
    if (expected) expect(within(row).getByText(expected)).toBeTruthy();
  });

  it("expands one list keeping type=movies and the other lists' params", () => {
    const many = (n: number, over: Partial<MovieSummary> = {}) =>
      Array.from({ length: n }, (_, i) =>
        movie({ movieId: String(i + 1), title: `M${i + 1}`, ...over }),
      );

    renderMovies(
      "archive",
      {
        watched: many(12, { status: "watched", watchedAt: new Date() }),
        notInterested: many(12, { status: "not_interested" }),
      },
      { type: "movies", movieNotInterested: "10", junk: "x" },
    );

    const links = screen
      .getAllByRole("link")
      .filter((l) => l.textContent?.includes("more"));
    expect(links).toHaveLength(2);

    const watched = new URL(links[0].getAttribute("href")!, "http://x/archive");
    expect(watched.searchParams.get("movieWatched")).toBe("20");
    expect(watched.searchParams.get("type")).toBe("movies");
    expect(watched.searchParams.get("movieNotInterested")).toBe("10");
    expect(watched.searchParams.has("junk")).toBe(false);
  });
});

describe("MovieStatusMenu", () => {
  it("lists the targets plus Remove for a watchlist movie", async () => {
    const { MovieStatusMenu } = await import("@/components/movie-status-menu");
    const { fireEvent } = await import("@testing-library/react");

    render(<MovieStatusMenu movieId="1" title="Heat" status="watchlist" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Change status for Heat" }),
    );

    expect(screen.getByText("Track Heat as")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Watched/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Not interested/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Remove/ })).toBeTruthy();
  });
});
