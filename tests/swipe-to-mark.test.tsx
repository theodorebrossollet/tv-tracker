// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markEpisodeWatched = vi.fn();
vi.mock("@/app/actions", () => ({
  markEpisodeWatched: (id: string) => markEpisodeWatched(id),
}));

const { SwipeToMark } = await import("@/components/swipe-to-mark");

beforeEach(() => {
  markEpisodeWatched.mockReset();
  markEpisodeWatched.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

const onOpen = vi.fn();

function renderCard(episodeId: string | null = "ep1") {
  onOpen.mockReset();
  render(
    <ul>
      <SwipeToMark episodeId={episodeId} className="card">
        <a href="#show" onClick={(event) => { event.preventDefault(); onOpen(); }}>
          Severance
        </a>
      </SwipeToMark>
    </ul>,
  );
  return screen.getByTestId("swipe-card");
}

/** As `discover-deck-ui` drags: one move to lock the axis, one to travel. */
function drag(el: HTMLElement, dx: number, dy = 0) {
  fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 100 + dx / 2, clientY: 100 + dy / 2 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 100 + dx, clientY: 100 + dy }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: 100 + dx, clientY: 100 + dy }] });
}

describe("swiping a Watching card", () => {
  it("marks the next episode when swiped right far enough", async () => {
    drag(renderCard(), 120);
    await waitFor(() => expect(markEpisodeWatched).toHaveBeenCalledWith("ep1"));
  });

  it("springs back without marking when the swipe falls short", () => {
    const el = renderCard();
    drag(el, 50);
    expect(markEpisodeWatched).not.toHaveBeenCalled();
    expect(el.style.transform).toBe("");
  });

  it("ignores leftward and vertical drags", () => {
    const el = renderCard();
    drag(el, -150);
    drag(el, 10, 150);
    expect(markEpisodeWatched).not.toHaveBeenCalled();
  });

  it("does nothing on a caught-up card, which has no episode to mark", () => {
    drag(renderCard(null), 150);
    expect(markEpisodeWatched).not.toHaveBeenCalled();
  });

  it("does not let a swipe end as a tap on the card's link", () => {
    // The title link is stretched over the whole card, so the click a swipe
    // ends with would otherwise open the show.
    const el = renderCard();
    drag(el, 120);
    fireEvent.click(screen.getByRole("link", { name: "Severance" }));
    expect(onOpen).not.toHaveBeenCalled();

    // The next plain tap still opens it.
    fireEvent.click(screen.getByRole("link", { name: "Severance" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows the action behind the card only while it is pulled aside", () => {
    const el = renderCard();
    expect(screen.queryByText("Watched")).toBeNull();

    fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 130, clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 160, clientY: 100 }] });
    expect(screen.getByText("Watched")).toBeTruthy();
    expect(el.style.transform).toBe("translateX(60px)");

    fireEvent.touchEnd(el);
    expect(screen.queryByText("Watched")).toBeNull();
  });
});
