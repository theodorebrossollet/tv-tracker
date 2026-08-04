// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The bar reads the route from `usePathname` and the overlay's state from the
// search provider. Both are stubbed so each case is one pathname.
let pathname = "/";
let searchOpen = false;

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("@/components/search-provider", () => ({
  useSearch: () => ({ open: vi.fn(), isOpen: searchOpen }),
}));

const { TabBar } = await import("@/components/tab-bar");

afterEach(() => {
  cleanup();
  pathname = "/";
  searchOpen = false;
});

/** The bar marks its active tab with `aria-current`, so read that back. */
function activeTab(): string | null {
  return screen.queryByRole("link", { current: "page" })?.textContent ?? null;
}

function renderAt(route: string) {
  pathname = route;
  return render(<TabBar />);
}

describe("which tab is active", () => {
  it("matches the dashboard exactly, not as a prefix", () => {
    // "/" is a prefix of every route, so `startsWith` would light Watching up
    // on all four screens.
    renderAt("/");
    expect(activeTab()).toBe("Watching");

    cleanup();
    renderAt("/settings");
    expect(activeTab()).toBe("Settings");
  });

  it("lights Library up on both of its routes", () => {
    // Library is one screen over two URLs — /archive is its second segment,
    // not a separate destination, and nothing else in the bar points at it.
    for (const route of ["/watchlist", "/archive"]) {
      renderAt(route);
      expect(activeTab()).toBe("Library");
      cleanup();
    }
  });

  it("leaves every tab inactive on a show page", () => {
    renderAt("/show/1396");
    expect(activeTab()).toBeNull();
  });
});

describe("the Search tab", () => {
  it("is a button rather than a link, so it opens the overlay", () => {
    // Search deliberately has no route: making it one would need its own gate
    // and would lose the scroll position of the screen behind it.
    renderAt("/");
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Search" })).toBeNull();
  });

  it("reports the overlay's state, having no pathname to read", () => {
    searchOpen = true;
    renderAt("/");

    const search = screen.getByRole("button", { name: "Search" });
    expect(search.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("routes that render without the bar", () => {
  it("hides on the sign-in and onboarding screens", () => {
    // Every tab points somewhere gated, so a bar here offers four destinations
    // that all bounce straight back to /login.
    for (const route of ["/login", "/login/password", "/welcome"]) {
      const { container } = renderAt(route);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });

  it("still renders everywhere else", () => {
    const { container } = renderAt("/");
    expect(container.innerHTML).not.toBe("");
  });
});
