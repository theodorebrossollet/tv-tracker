// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ShowList renders AddButton, which imports server actions. The list's
// pagination is what's under test, so the actions are stubbed out.
vi.mock("@/app/actions", () => ({
  addToWatchlist: vi.fn(),
  removeShow: vi.fn(),
}));

const { StatusBadge } = await import("@/components/status-badge");
const { ShowList } = await import("@/components/show-list");
const { limitFrom } = await import("@/components/show-more-link");
import type { TrackedShowSummary } from "@/lib/queries";
import type { TrackStatus } from "@/lib/types";

afterEach(cleanup);

function show(id: string, status: TrackStatus = "watching"): TrackedShowSummary {
  return {
    showId: id,
    name: `Show ${id}`,
    posterPath: null,
    status,
    airedCount: 10,
    watchedCount: 10,
    fullyWatched: true,
    showStatus: "Ended",
    lastWatchedAt: null,
    addedAt: new Date(),
    nextUnwatched: null,
  };
}

describe("StatusBadge", () => {
  it("names every status, including the two added later", () => {
    // The bug this guards: search showed a tick for paused and stopped shows
    // with no label, because only two statuses were handled.
    for (const [status, label] of [
      ["watching", "Watching"],
      ["watchlist", "Watchlist"],
      ["paused", "Paused"],
      ["stopped", "Stopped"],
    ] as const) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  it("renders nothing for an untracked show", () => {
    const { container } = render(<StatusBadge status={null} />);
    expect(container.innerHTML).toBe("");
  });
});

/** ShowList's disclosure props, with the URL state a page would pass in. */
function paging(limit: number, params: Record<string, string> = {}) {
  return { param: "finished", searchParams: params, limit } as const;
}

describe("ShowList pagination", () => {
  it("shows only the first page and offers the rest", () => {
    const shows = Array.from({ length: 25 }, (_, i) => show(`s${i}`));

    render(<ShowList shows={shows} pageSize={10} {...paging(10)} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByRole("link", { name: /Show 10 more/ })).toBeTruthy();
    expect(screen.getByText(/15 left/)).toBeTruthy();
  });

  it("offers no link when everything fits", () => {
    render(<ShowList shows={[show("a"), show("b")]} pageSize={10} {...paging(10)} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /more/ })).toBeNull();
  });

  it("counts the final partial page correctly", () => {
    // 12 shows, 10 per page — the link should offer 2, not 10.
    render(
      <ShowList
        shows={Array.from({ length: 12 }, (_, i) => show(`s${i}`))}
        pageSize={10}
        {...paging(10)}
      />,
    );

    expect(screen.getByRole("link", { name: /Show 2 more/ })).toBeTruthy();
  });

  it("renders exactly the limit it is given", () => {
    // The reveal is URL state now, so a limit past the first page is what an
    // expanded list looks like on a fresh render.
    render(
      <ShowList
        shows={Array.from({ length: 25 }, (_, i) => show(`s${i}`))}
        pageSize={10}
        {...paging(20)}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getByRole("link", { name: /Show 5 more/ })).toBeTruthy();
  });

  it("asks for one more page than it is showing", () => {
    render(
      <ShowList
        shows={Array.from({ length: 25 }, (_, i) => show(`s${i}`))}
        pageSize={10}
        {...paging(10)}
      />,
    );

    expect(
      screen.getByRole("link", { name: /Show 10 more/ }).getAttribute("href"),
    ).toBe("?finished=20");
  });

  it("carries the other lists' params across", () => {
    // Two lists on one page (Archive's Finished and Stopped). Expanding one
    // must not collapse the other, and the only thing holding the other's
    // state is the query string — so the link has to preserve it.
    render(
      <ShowList
        shows={Array.from({ length: 25 }, (_, i) => show(`s${i}`))}
        pageSize={10}
        {...paging(10, { stopped: "30" })}
      />,
    );

    const href = screen
      .getByRole("link", { name: /Show 10 more/ })
      .getAttribute("href");

    expect(href).toContain("stopped=30");
    expect(href).toContain("finished=20");
  });

  it("shows watch progress when asked, availability otherwise", () => {
    const { unmount } = render(
      <ShowList shows={[show("a")]} detail="progress" {...paging(10)} />,
    );
    expect(screen.getByText("10 / 10 watched")).toBeTruthy();
    unmount();

    render(<ShowList shows={[show("a")]} {...paging(10)} />);
    expect(screen.getByText("10 episodes available")).toBeTruthy();
  });
});

describe("reading a list's limit off the URL", () => {
  it("falls back to the default for anything that isn't a positive integer", () => {
    // The param is attacker-supplied like any other.
    for (const raw of ["0", "-5", "abc", "1.5", "", undefined]) {
      expect(limitFrom({ finished: raw }, "finished", 10)).toBe(10);
    }
  });

  it("caps an absurd request rather than rejecting it", () => {
    // A large number is still a number, so it survives the parse — the cap is
    // what stops a hand-edited link asking the server to render every row it
    // holds. `1e9` is included because it parses to an integer despite not
    // looking like one, which is exactly the case a stricter-looking regex
    // check would wave through.
    expect(limitFrom({ finished: "100000" }, "finished", 10)).toBe(500);
    expect(limitFrom({ finished: "1e9" }, "finished", 10)).toBe(500);
  });

  it("takes a sensible value as given", () => {
    expect(limitFrom({ finished: "30" }, "finished", 10)).toBe(30);
  });
});
