// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const { PullToRefreshPage } = await import(
  "@/components/pull-to-refresh-page"
);

beforeEach(() => {
  refresh.mockReset();
  window.scrollY = 0;
});

afterEach(cleanup);

// jsdom has no TouchEvent constructor, but the hook only reads `touches` and
// listens on `document`, so a plain event carrying that list is all it sees.
function touch(type: string, points: { x: number; y: number }[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: points.map((p) => ({ clientX: p.x, clientY: p.y })),
  });
  act(() => {
    document.dispatchEvent(event);
  });
}

function drag(dx: number, dy: number) {
  touch("touchstart", [{ x: 100, y: 100 }]);
  // Two moves: the first commits to a direction, the second is the pull.
  touch("touchmove", [{ x: 100 + dx / 2, y: 100 + dy / 2 }]);
  touch("touchmove", [{ x: 100 + dx, y: 100 + dy }]);
}

describe("pulling a list screen", () => {
  it("takes no room and says nothing at rest", () => {
    render(<PullToRefreshPage />);

    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    expect(region.style.height).toBe("0px");
  });

  it("re-renders the page from the server once pulled far enough", () => {
    render(<PullToRefreshPage />);

    // `resist` halves the finger's travel, so 200px pulls the strip past
    // the 70px threshold.
    drag(0, 200);
    expect(screen.getByText("Release to refresh")).toBeTruthy();

    touch("touchend", []);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a short pull", () => {
    render(<PullToRefreshPage />);

    drag(0, 60);
    expect(screen.getByText("Pull to refresh")).toBeTruthy();

    touch("touchend", []);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does nothing once the page is scrolled down", () => {
    // Mid-list, a downward drag is a scroll back up, not a refresh.
    window.scrollY = 300;
    render(<PullToRefreshPage />);

    drag(0, 200);
    touch("touchend", []);

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("which screens have it", () => {
  // Settings is left out on purpose: nothing on it changes except by the
  // reader's own hand. The show page has its own strip, which re-syncs TMDB.
  it.each(["src/app/page.tsx", "src/components/library-screen.tsx"])(
    "%s renders it",
    (file) => {
      expect(readFileSync(file, "utf8")).toContain("<PullToRefreshPage />");
    },
  );
});
