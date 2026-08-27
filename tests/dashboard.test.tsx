// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ShowGrid renders MarkWatchedButton, which imports a server action. What the
// row renders is under test, not what the action does.
vi.mock("@/app/actions", () => ({ markEpisodeWatched: vi.fn() }));

const { ShowGrid } = await import("@/components/show-grid");
const { UpcomingList } = await import("@/components/upcoming-list");

import type { TrackedShowSummary, UpcomingEpisode } from "@/lib/queries";

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
    status: "watching",
    airedCount: 19,
    watchedCount: 16,
    fullyWatched: false,
    showStatus: "Returning Series",
    lastWatchedAt: null,
    addedAt: new Date(),
    nextUnwatched: {
      id: "101-e17",
      seasonNumber: 2,
      episodeNumber: 7,
      name: "Chikhai Bardo",
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

describe("the in-progress count", () => {
  it("counts the rows on screen", () => {
    // Derived rather than tracked optimistically: marking the last aired
    // episode moves a show out of this bucket, so an optimistic count would
    // tick down while the row it refers to is still visible.
    render(<ShowGrid shows={[show(), show({ showId: "102" })]} />);

    expect(screen.getByText("2 shows in progress")).toBeTruthy();
  });

  it("does not say '1 shows'", () => {
    render(<ShowGrid shows={[show()]} />);

    expect(screen.getByText("1 show in progress")).toBeTruthy();
  });
});

describe("how soon an upcoming episode airs", () => {
  const paging = { searchParams: {}, limit: 15 };

  it("accents a date inside the week and leaves the rest quiet", () => {
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
    const soon = screen.getByText("In 2 days");
    const later = soon.closest("ul")!.querySelectorAll("li")[1];

    expect(soon.className).toContain("text-accent-deep");
    expect(later.textContent).not.toContain("In ");
    expect(later.querySelector(".text-faint")).toBeTruthy();
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
