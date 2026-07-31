// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ShowList renders AddButton, which imports server actions. The list's
// pagination is what's under test, so the actions are stubbed out.
vi.mock("@/app/actions", () => ({
  addToWatchlist: vi.fn(),
  removeShow: vi.fn(),
}));

const { StatusBadge } = await import("@/components/status-badge");
const { ShowList } = await import("@/components/show-list");
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

describe("ShowList pagination", () => {
  it("shows only the first page and offers the rest", () => {
    const shows = Array.from({ length: 25 }, (_, i) => show(`s${i}`));

    render(<ShowList shows={shows} pageSize={10} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByRole("button", { name: /Show 10 more/ })).toBeTruthy();
    expect(screen.getByText(/15 left/)).toBeTruthy();
  });

  it("offers no button when everything fits", () => {
    render(<ShowList shows={[show("a"), show("b")]} pageSize={10} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /more/ })).toBeNull();
  });

  it("counts the final partial page correctly", () => {
    // 12 shows, 10 per page — the button should offer 2, not 10.
    render(<ShowList shows={Array.from({ length: 12 }, (_, i) => show(`s${i}`))} pageSize={10} />);

    expect(screen.getByRole("button", { name: /Show 2 more/ })).toBeTruthy();
  });

  it("keeps each list's count independent", () => {
    // Two lists on one page (Archive's Finished and Stopped): expanding one
    // must not reveal rows in the other.
    //
    // The click is the whole test. Counting rows before expanding passes even
    // with a single shared counter, since both lists start at the same size —
    // verified by reintroducing exactly that bug.
    const { container } = render(
      <>
        <div data-testid="first">
          <ShowList shows={Array.from({ length: 20 }, (_, i) => show(`a${i}`))} pageSize={10} />
        </div>
        <div data-testid="second">
          <ShowList shows={Array.from({ length: 20 }, (_, i) => show(`b${i}`))} pageSize={10} />
        </div>
      </>,
    );

    const first = within(screen.getByTestId("first"));
    const second = within(screen.getByTestId("second"));

    expect(first.getAllByRole("listitem")).toHaveLength(10);
    expect(second.getAllByRole("listitem")).toHaveLength(10);

    fireEvent.click(first.getByRole("button", { name: /Show 10 more/ }));

    expect(first.getAllByRole("listitem")).toHaveLength(20);
    // The one that matters: the second list must not have moved.
    expect(second.getAllByRole("listitem")).toHaveLength(10);
    expect(container).toBeTruthy();
  });

  it("reveals the next page on click", () => {
    render(<ShowList shows={Array.from({ length: 25 }, (_, i) => show(`s${i}`))} pageSize={10} />);

    fireEvent.click(screen.getByRole("button", { name: /Show 10 more/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(20);

    // Last page is partial, and the button should say so before disappearing.
    fireEvent.click(screen.getByRole("button", { name: /Show 5 more/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(25);
    expect(screen.queryByRole("button", { name: /more/ })).toBeNull();
  });

  it("shows watch progress when asked, availability otherwise", () => {
    const { unmount } = render(<ShowList shows={[show("a")]} detail="progress" />);
    expect(screen.getByText("10 / 10 watched")).toBeTruthy();
    unmount();

    render(<ShowList shows={[show("a")]} />);
    expect(screen.getByText("10 episodes available")).toBeTruthy();
  });
});
