// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ markEpisodeWatched: vi.fn() }));
vi.mock("@/components/search-icon-button", () => ({ SearchIconButton: () => null }));
vi.mock("@/components/discover-icon-button", () => ({ DiscoverIconButton: () => null }));
vi.mock("@/components/find-show-button", () => ({ FindShowButton: () => null }));
vi.mock("@/components/pull-to-refresh-page", () => ({ PullToRefreshPage: () => null }));
vi.mock("@/lib/auth", () => ({
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "s",
    user: { id: "u1", nickname: "u", hasPassword: true },
  })),
}));
vi.mock("@/lib/queries", () => ({
  getShowBuckets: vi.fn(async () => ({ watching: [] })),
  getUpcomingEpisodes: vi.fn(async () => []),
}));
vi.mock("@/lib/shows", () => ({
  getSettings: vi.fn(async () => ({ country: "FR", providerIds: null, notifyEnabled: false })),
}));
vi.mock("@/lib/upcoming-movies", () => ({ getUpcomingMovies: vi.fn(async () => []) }));

const { default: DashboardPage } = await import("@/app/page");
const { getUpcomingEpisodes } = await import("@/lib/queries");
const { getUpcomingMovies } = await import("@/lib/upcoming-movies");

import type { UpcomingEpisode } from "@/lib/queries";
import type { UpcomingMovie } from "@/lib/upcoming-movies";

const DAY_MS = 24 * 60 * 60 * 1000;

const episode = (over: Partial<UpcomingEpisode> = {}): UpcomingEpisode => ({
  episodeId: "e1",
  showId: "101",
  showName: "Severance",
  posterPath: null,
  status: "watching",
  seasonNumber: 2,
  episodeNumber: 11,
  name: "Who Are You?",
  airDate: new Date(Date.now() + 3 * DAY_MS),
  ...over,
});

const movie = (over: Partial<UpcomingMovie> = {}): UpcomingMovie => ({
  movieId: "603",
  title: "The Matrix",
  posterPath: null,
  next: { kind: "cinema", date: new Date(Date.now() + 10 * DAY_MS) },
  later: null,
  region: null,
  ...over,
});

async function renderPage(searchParams: Record<string, string> = {}) {
  render(await DashboardPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUpcomingEpisodes).mockResolvedValue([]);
  vi.mocked(getUpcomingMovies).mockResolvedValue([]);
});
afterEach(cleanup);

describe("the Watching screen's upcoming sections", () => {
  it("keeps episodes and movies in separate sections", async () => {
    vi.mocked(getUpcomingEpisodes).mockResolvedValue([episode()]);
    vi.mocked(getUpcomingMovies).mockResolvedValue([movie()]);
    await renderPage();

    const episodes = screen.getByRole("heading", { name: "Upcoming episodes" }).closest("section")!;
    const movies = screen.getByRole("heading", { name: "Upcoming movies" }).closest("section")!;

    expect(episodes.textContent).toContain("Severance");
    expect(episodes.textContent).not.toContain("The Matrix");
    expect(movies.textContent).toContain("The Matrix");
    expect(movies.textContent).not.toContain("Severance");
  });

  it("hides the movies section when there are no upcoming movies", async () => {
    vi.mocked(getUpcomingEpisodes).mockResolvedValue([episode()]);
    await renderPage();

    expect(screen.getByRole("heading", { name: "Upcoming episodes" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Upcoming movies" })).toBeNull();
  });

  it("still shows the episodes section's own empty state, with movies present", async () => {
    vi.mocked(getUpcomingMovies).mockResolvedValue([movie()]);
    await renderPage();

    expect(screen.getByText("Nothing scheduled")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Upcoming movies" })).toBeTruthy();
  });

  it("asks for the movies in the saved country, for this account", async () => {
    await renderPage();
    expect(getUpcomingMovies).toHaveBeenCalledWith("u1", "FR");
  });

  it("pages each section on its own param", async () => {
    vi.mocked(getUpcomingEpisodes).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) =>
        episode({ episodeId: `e${i}`, showName: `Show ${i}`, airDate: new Date(Date.now() + (i + 1) * DAY_MS) }),
      ),
    );
    vi.mocked(getUpcomingMovies).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => movie({ movieId: String(i + 1), title: `Movie ${i + 1}` })),
    );
    await renderPage({ upcomingMovies: "20" });

    const episodes = screen.getByRole("heading", { name: "Upcoming episodes" }).closest("section")!;
    const movies = screen.getByRole("heading", { name: "Upcoming movies" }).closest("section")!;
    // Episodes still on their first page, movies expanded to all twenty.
    expect(episodes.querySelectorAll("li")).toHaveLength(15);
    expect(movies.querySelectorAll("li")).toHaveLength(20);
  });
});
