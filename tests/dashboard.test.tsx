// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ShowGrid renders MarkWatchedButton, which imports a server action. What the
// row renders is under test, not what the action does.
vi.mock("@/app/actions", () => ({ markEpisodeWatched: vi.fn() }));

const { ShowGrid } = await import("@/components/show-grid");
const { WatchingHero } = await import("@/components/watching-hero");
const { splitHero } = await import("@/lib/watching");
const { UpcomingList } = await import("@/components/upcoming-list");
const { UpcomingMoviesList } = await import("@/components/upcoming-movies-list");

import type { TrackedShowSummary, UpcomingEpisode } from "@/lib/queries";
import type { UpcomingMovie } from "@/lib/upcoming-movies";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DAY_MS = 24 * 60 * 60 * 1000;

function show(overrides: Partial<TrackedShowSummary> = {}): TrackedShowSummary {
  return {
    showId: "101",
    name: "Severance",
    posterPath: null,
    backdropPath: null,
    status: "watching",
    airedCount: 19,
    watchedCount: 16,
    fullyWatched: false,
    showStatus: "Returning Series",
    lastWatchedAt: null,
    addedAt: new Date(),
    ratingAverage: null,
    nextUnwatched: {
      id: "101-e17",
      seasonNumber: 2,
      episodeNumber: 7,
      name: "Chikhai Bardo",
      runtime: 50,
      stillPath: null,
    },
    ...overrides,
  };
}

function episode(overrides: Partial<UpcomingEpisode> = {}): UpcomingEpisode {
  return {
    episodeId: "e1",
    showId: "101",
    showName: "Severance",
    posterPath: null,
    status: "watching",
    seasonNumber: 2,
    episodeNumber: 11,
    name: "Who Are You?",
    airDate: new Date(Date.now() + 3 * DAY_MS),
    ...overrides,
  };
}

describe("the inline mark-watched button", () => {
  it("names the show as well as the episode", () => {
    // "Mark S02E07 watched" is ambiguous down a list of ten rows, which is
    // exactly the situation this button exists for.
    render(<ShowGrid shows={[show()]} />);

    expect(
      screen.getByRole("button", { name: "Mark Severance S02E07 watched" }),
    ).toBeTruthy();
  });

  it("is absent once there is nothing left to mark", () => {
    // A caught-up row has no next episode, so the button has nothing to act
    // on — it says so in words instead.
    render(
      <ShowGrid
        shows={[show({ nextUnwatched: null, watchedCount: 19 })]}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Caught up")).toBeTruthy();
  });

  it("says the series is over rather than that you are caught up", () => {
    render(
      <ShowGrid
        shows={[
          show({
            nextUnwatched: null,
            watchedCount: 19,
            showStatus: "Ended",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Series finished")).toBeTruthy();
  });
});

describe("the Watching hero", () => {
  it("features the first show with an episode ready, and leaves the rest to the list", () => {
    // `getShowBuckets` orders by actionability, so a caught-up show can sit
    // first only when nothing is ready; it must never take the hero.
    const caughtUp = show({ showId: "1", nextUnwatched: null, watchedCount: 19 });
    const ready = show({ showId: "2", name: "Dark" });
    const later = show({ showId: "3", name: "Andor" });

    const { hero, rest } = splitHero([caughtUp, ready, later]);

    expect(hero?.showId).toBe("2");
    expect(rest.map((entry) => entry.showId)).toEqual(["1", "3"]);
  });

  it("has no hero when nothing is ready to watch", () => {
    const shows = [show({ nextUnwatched: null, watchedCount: 19 })];
    expect(splitHero(shows)).toEqual({ hero: null, rest: shows });
  });

  it("names the episode up next and marks it from a labelled button", () => {
    const { hero } = splitHero([
      show({
        nextUnwatched: {
          id: "e5",
          seasonNumber: 2,
          episodeNumber: 5,
          name: "Trojan's Horse",
          runtime: 52,
          stillPath: null,
        },
      }),
    ]);
    render(<WatchingHero show={hero!} nickname="Theo" />);

    expect(screen.getByRole("heading", { name: "Watching" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Severance" })).toBeTruthy();
    expect(screen.getByText("S2 · E5")).toBeTruthy();
    expect(screen.getByText("Trojan's Horse · 52m")).toBeTruthy();
    expect(screen.getByText("16 of 19")).toBeTruthy();

    const button = screen.getByRole("button", { name: "Mark Severance S02E05 watched" });
    expect(button.textContent).toContain("Mark watched");
    expect(screen.getByRole("link", { name: "Open Severance" }).getAttribute("href")).toBe("/show/101");
  });

  it("falls back to the poster when the show has no backdrop yet", () => {
    const { hero } = splitHero([show({ posterPath: "/poster.jpg", backdropPath: null })]);
    const { container } = render(<WatchingHero show={hero!} nickname="Theo" />);

    expect(container.querySelector("img")?.getAttribute("src")).toContain("poster.jpg");
  });
});

describe("how soon an upcoming episode airs", () => {
  const paging = { searchParams: {}, limit: 15 };

  it("heads each day inside the week, accented, and puts the rest under Later", () => {
    // Pinned to noon UTC (safely inside the same calendar day in US Eastern
    // too) rather than the real clock: `daysUntil` reads "today" in Eastern,
    // so anchoring these fixtures to `Date.now()` made this test's outcome
    // depend on what time it happened to run.
    const now = new Date("2026-07-29T12:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    render(
      <UpcomingList
        episodes={[
          episode({ episodeId: "soon", airDate: new Date(now + 2 * DAY_MS) }),
          episode({ episodeId: "later", airDate: new Date(now + 30 * DAY_MS) }),
        ]}
        {...paging}
      />,
    );

    // Read off the rendered class rather than a colour: the token is what the
    // component chooses, and the scheme decides what it resolves to.
    const soon = screen.getByRole("heading", { name: "Friday" });
    const later = screen.getByRole("heading", { name: "Later" });

    expect(soon.className).toContain("text-highlight");
    expect(later.className).toContain("text-faint");
    expect(later.className).not.toContain("text-highlight");
    // Under Later the row carries its own date.
    expect(later.nextElementSibling!.textContent).toContain("28 Aug");
  });

  it("collapses a show's episodes on one day into one row", () => {
    const now = new Date("2026-07-29T12:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const drop = new Date(now + 3 * DAY_MS);

    render(
      <UpcomingList
        episodes={[
          episode({ episodeId: "a", episodeNumber: 1, airDate: drop }),
          episode({ episodeId: "b", episodeNumber: 2, airDate: drop }),
          episode({ episodeId: "c", episodeNumber: 3, airDate: drop }),
          episode({ episodeId: "d", showId: "202", showName: "Dark", airDate: drop }),
        ]}
        {...paging}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("S02E01–E03 · 3 episodes")).toBeTruthy();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("flags only the shows you haven't started", () => {
    // A "Watching" badge on most rows would be noise; the useful signal is
    // that an episode is coming for something still on the watchlist.
    render(
      <UpcomingList
        episodes={[
          episode({ episodeId: "a", status: "watchlist" }),
          episode({ episodeId: "b", status: "watching" }),
        ]}
        {...paging}
      />,
    );

    expect(screen.getAllByText("Watchlist")).toHaveLength(1);
  });
});

describe("the upcoming movies list", () => {
  const movie = (over: Partial<UpcomingMovie> = {}): UpcomingMovie => ({
    movieId: "603",
    title: "The Matrix",
    posterPath: null,
    next: { kind: "cinema", date: new Date(Date.now() + 10 * DAY_MS) },
    later: null,
    ...over,
  });

  const renderList = (movies: UpcomingMovie[], limit = 15) =>
    render(
      <UpcomingMoviesList movies={movies} searchParams={{}} limit={limit} />,
    );

  it("links a movie row to the movie page and says what the date is", () => {
    renderList([movie()]);

    expect(
      screen.getByRole("link", { name: /The Matrix/ }).getAttribute("href"),
    ).toBe("/movie/603");
    expect(screen.getByRole("img", { name: "Movie" })).toBeTruthy();
    expect(screen.getByText("In cinemas")).toBeTruthy();
  });

  it("names the later release when there is one", () => {
    renderList([
      movie({
        later: { kind: "digital", date: new Date(Date.now() + 40 * DAY_MS) },
      }),
    ]);

    const line = screen.getByText(/^In cinemas · Digital /);
    expect(line.textContent).toMatch(
      /^In cinemas · Digital \d{1,2} \w{3}$/,
    );
  });

  it("shows a digital-only movie as Digital", () => {
    renderList([
      movie({ next: { kind: "digital", date: new Date(Date.now() + 9 * DAY_MS) } }),
    ]);
    expect(screen.getByText("Digital")).toBeTruthy();
    expect(screen.queryByText(/In cinemas/)).toBeNull();
  });

  it("keeps the order it is given and pages on its own param", () => {
    const many = Array.from({ length: 4 }, (_, i) =>
      movie({ movieId: String(i + 1), title: `M${i + 1}` }),
    );
    renderList(many, 2);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("M1");
    expect(rows[1].textContent).toContain("M2");
    const more = screen.getByRole("link", { name: /Load 2 more/ });
    expect(more.getAttribute("href")).toContain("upcomingMovies=");
    expect(more.getAttribute("href")).not.toContain("upcoming=");
  });

  it("never prints NaN or undefined", () => {
    const { container } = renderList([movie()]);
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });
});
