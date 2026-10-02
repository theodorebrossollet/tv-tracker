// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const openForList = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/app/list-actions", () => ({
  createList: vi.fn(),
  updateList: vi.fn(async () => ({ ok: true })),
  deleteList: vi.fn(async () => ({ ok: true })),
  removeFromList: vi.fn(async () => ({ ok: true })),
  setListItemWatched: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions", () => ({
  addToWatchlist: vi.fn(async () => ({ ok: true })),
  pauseShow: vi.fn(async () => ({ ok: true })),
  removeShow: vi.fn(async () => ({ ok: true })),
  resumeShow: vi.fn(async () => ({ ok: true })),
  stopShow: vi.fn(async () => ({ ok: true })),
  setMovieStatus: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/components/search-provider", () => ({
  useSearch: () => ({ open: vi.fn(), openForList, isOpen: false }),
}));
vi.mock("@/lib/auth", () => ({
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "s",
    user: { id: "u1", nickname: "u", hasPassword: true },
  })),
}));
vi.mock("@/lib/queries", () => ({ getListDetail: vi.fn() }));

const { default: ListPage, generateMetadata } =
  await import("@/app/lists/[id]/page");
const { getListDetail } = await import("@/lib/queries");
const { requireOnboardedSession } = await import("@/lib/auth");
const actions = await import("@/app/list-actions");
const movieActions = await import("@/app/actions");

import type { ListDetail, ListItemView } from "@/lib/queries";

const detailMock = vi.mocked(getListDetail);
const gate = vi.mocked(requireOnboardedSession);

function item(over: Partial<ListItemView> = {}): ListItemView {
  return {
    itemId: "i1",
    kind: "movie",
    titleId: "603",
    title: "The Matrix",
    posterPath: "/m.jpg",
    year: "1999",
    status: null,
    finished: false,
    tickedAt: null,
    watched: false,
    addedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

function list(over: Partial<ListDetail> = {}): ListDetail {
  return {
    id: "L1",
    name: "Movie night",
    trackSeparately: false,
    items: [item()],
    ...over,
  };
}

async function renderPage(
  detail: ListDetail | null,
  searchParams: Record<string, string | string[] | undefined> = {},
) {
  detailMock.mockResolvedValue(detail);
  render(
    await ListPage({
      params: Promise.resolve({ id: "L1" }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("the list page route", () => {
  it("is not found for an unknown or foreign list, leaking nothing", async () => {
    detailMock.mockResolvedValue(null);

    await expect(
      ListPage({
        params: Promise.resolve({ id: "other" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(detailMock).toHaveBeenCalledWith("u1", "other");
    expect(
      await generateMetadata({ params: Promise.resolve({ id: "other" }) }),
    ).toEqual({
      title: "List · TV Tracker",
    });
  });

  it("lets a rejected gate win over everything", async () => {
    gate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(
      ListPage({
        params: Promise.resolve({ id: "L1" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(detailMock).not.toHaveBeenCalled();

    gate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(
      generateMetadata({ params: Promise.resolve({ id: "L1" }) }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(detailMock).not.toHaveBeenCalled();
  });

  it("titles the tab with the list name", async () => {
    detailMock.mockResolvedValue(list());
    expect(
      await generateMetadata({ params: Promise.resolve({ id: "L1" }) }),
    ).toEqual({
      title: "Movie night · TV Tracker",
    });
  });

  it("shows the name, a back link and the add button", async () => {
    await renderPage(list());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Movie night",
    );
    expect(
      screen.getByRole("link", { name: "Back" }).getAttribute("href"),
    ).toBe("/lists");
    fireEvent.click(screen.getByRole("button", { name: "Add titles" }));
    expect(openForList).toHaveBeenCalledWith({ id: "L1", name: "Movie night" });
  });

  it("invites adding titles to an empty list", async () => {
    await renderPage(list({ items: [] }));

    expect(screen.getByText(/nothing here yet/i)).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: "Add titles" });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(openForList).toHaveBeenCalledWith({ id: "L1", name: "Movie night" });
  });
});

describe("sections", () => {
  it("renders Watched only when something is watched, keeping order", async () => {
    await renderPage(
      list({
        items: [
          item({ itemId: "a", titleId: "1", title: "Alpha" }),
          item({
            itemId: "b",
            titleId: "2",
            title: "Beta",
            watched: true,
            status: "watched",
          }),
        ],
      }),
    );

    expect(screen.getByRole("heading", { name: "Watched" })).toBeTruthy();
    const links = screen.getAllByRole("link").map((l) => l.textContent);
    expect(links.indexOf("Alpha")).toBeLessThan(links.indexOf("Beta"));
    cleanup();

    await renderPage(list());
    expect(screen.queryByRole("heading", { name: "Watched" })).toBeNull();
  });

  it("links a movie and a show with the same id to their own pages", async () => {
    await renderPage(
      list({
        items: [
          item({ itemId: "a", kind: "movie", titleId: "100", title: "Film" }),
          item({ itemId: "b", kind: "show", titleId: "100", title: "Series" }),
        ],
      }),
    );

    expect(
      screen.getByRole("link", { name: "Film" }).getAttribute("href"),
    ).toBe("/movie/100");
    expect(
      screen.getByRole("link", { name: "Series" }).getAttribute("href"),
    ).toBe("/show/100");
    expect(screen.getByRole("img", { name: "Movie" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "TV show" })).toBeTruthy();
  });

  it("paginates each section on its own param and carries the known ones", async () => {
    const toWatch = Array.from({ length: 12 }, (_, n) =>
      item({ itemId: `t${n}`, titleId: `${n}`, title: `Todo ${n}` }),
    );
    const done = Array.from({ length: 12 }, (_, n) =>
      item({
        itemId: `w${n}`,
        titleId: `${100 + n}`,
        title: `Done ${n}`,
        watched: true,
      }),
    );
    await renderPage(list({ items: [...toWatch, ...done] }), {
      type: "movies",
      evil: "x",
    });

    const more = screen
      .getAllByRole("link")
      .filter((l) => /^Show \d+ more/.test(l.textContent ?? ""));
    expect(more).toHaveLength(2);
    const hrefs = more.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("?type=movies&listToWatch=20");
    expect(hrefs).toContain("?type=movies&listWatched=20");
    expect(hrefs.join()).not.toContain("evil");
    expect(screen.queryByText("Todo 11")).toBeNull();
  });

  it("honours a limit from the URL", async () => {
    const toWatch = Array.from({ length: 12 }, (_, n) =>
      item({ itemId: `t${n}`, titleId: `${n}`, title: `Todo ${n}` }),
    );
    await renderPage(list({ items: toWatch }), { listToWatch: "12" });
    expect(screen.getByText("Todo 11")).toBeTruthy();
  });
});

describe("a personal list", () => {
  it("shows the real movie status and a mark-watched button when not watched", async () => {
    await renderPage(
      list({
        items: [
          item({
            itemId: "a",
            titleId: "1",
            title: "Tracked",
            status: "watchlist",
          }),
          item({ itemId: "b", titleId: "2", title: "Untracked", status: null }),
          item({
            itemId: "c",
            titleId: "3",
            title: "Seen",
            status: "watched",
            watched: true,
          }),
        ],
      }),
    );

    const rows = screen.getAllByRole("listitem");
    const row = (name: string) =>
      rows.find((r) => within(r).queryByRole("link", { name }))!;

    expect(within(row("Tracked")).getByText("Watchlist")).toBeTruthy();
    expect(
      within(row("Untracked")).queryByText(/^(watchlist|watching|watched)$/i),
    ).toBeNull();
    expect(
      within(row("Untracked")).getByRole("button", { name: "Mark watched" }),
    ).toBeTruthy();
    expect(within(row("Seen")).getByText("Watched")).toBeTruthy();
    expect(
      within(row("Seen")).queryByRole("button", { name: "Mark watched" }),
    ).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /watched together/i }),
    ).toBeNull();

    fireEvent.click(
      within(row("Tracked")).getByRole("button", { name: "Mark watched" }),
    );
    await waitFor(() =>
      expect(movieActions.setMovieStatus).toHaveBeenCalledWith("1", "watched"),
    );
  });

  it("gives a show its status and neither a tick nor mark-watched", async () => {
    await renderPage(
      list({
        items: [
          item({
            itemId: "a",
            kind: "show",
            titleId: "9",
            title: "Series",
            status: "watching",
          }),
          item({
            itemId: "b",
            kind: "show",
            titleId: "8",
            title: "Fresh",
            status: null,
          }),
        ],
      }),
    );

    expect(screen.getByText("Watching")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /mark watched/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /together/i })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("a together list", () => {
  const together = (items: ListItemView[]) =>
    list({ trackSeparately: true, items });

  it("ticks any row with the list's own mark", async () => {
    await renderPage(
      together([
        item({ itemId: "m", titleId: "1", title: "Film", status: null }),
        item({
          itemId: "s",
          kind: "show",
          titleId: "2",
          title: "Series",
          status: "watching",
        }),
      ]),
    );

    expect(screen.queryByRole("button", { name: "Mark watched" })).toBeNull();
    const ticks = screen.getAllByRole("button", {
      name: /mark watched together/i,
    });
    expect(ticks).toHaveLength(2);

    fireEvent.click(ticks[0]);
    await waitFor(() =>
      expect(actions.setListItemWatched).toHaveBeenCalledWith("L1", "m", true),
    );
  });

  it("unticks a ticked row and says nothing about status for an untracked title", async () => {
    await renderPage(
      together([
        item({
          itemId: "m",
          titleId: "1",
          title: "Film",
          status: null,
          tickedAt: new Date("2026-02-01T00:00:00Z"),
          watched: true,
        }),
      ]),
    );

    const tick = screen.getByRole("button", { name: /^watched together/i });
    expect(tick.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/you've seen this/i)).toBeNull();
    expect(screen.queryByText("Watchlist")).toBeNull();

    fireEvent.click(tick);
    await waitFor(() =>
      expect(actions.setListItemWatched).toHaveBeenCalledWith("L1", "m", false),
    );
  });

  it("notes when you have really seen it", async () => {
    await renderPage(
      together([
        item({
          itemId: "m",
          titleId: "1",
          title: "Film",
          status: "watched",
          watched: false,
        }),
        item({
          itemId: "s",
          kind: "show",
          titleId: "2",
          title: "Series",
          status: "watching",
          finished: true,
        }),
        item({
          itemId: "p",
          kind: "show",
          titleId: "3",
          title: "Partial",
          status: "watching",
        }),
      ]),
    );

    expect(screen.getAllByText("You've seen this")).toHaveLength(2);
  });

  it("keeps a failure message after the action settles", async () => {
    vi.mocked(actions.setListItemWatched).mockResolvedValueOnce({
      ok: false,
      error: "Could not tick that.",
    });
    await renderPage(together([item({ itemId: "m" })]));

    fireEvent.click(
      screen.getByRole("button", { name: /mark watched together/i }),
    );
    await screen.findByText("Could not tick that.");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("Could not tick that.")).toBeTruthy();
  });
});

describe("row menu", () => {
  it("removes from the list and keeps a failure on screen", async () => {
    vi.mocked(actions.removeFromList).mockResolvedValueOnce({
      ok: false,
      error: "Could not remove it.",
    });
    await renderPage(list());

    fireEvent.click(
      screen.getByRole("button", { name: "Options for The Matrix" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove from list" }));

    await waitFor(() =>
      expect(actions.removeFromList).toHaveBeenCalledWith("L1", "i1"),
    );
    await screen.findByText("Could not remove it.");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("Could not remove it.")).toBeTruthy();
  });

  it("renders no stray separators or NaN for a title with no poster or year", async () => {
    await renderPage(
      list({
        items: [item({ posterPath: null, year: null, title: "Bare" })],
      }),
    );

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/undefined|NaN|·\s*$|^\s*·|·\s*·/);
    expect(text).toContain("No poster");
    expect(text).toContain("Bare");
    expect(screen.getByRole("listitem").textContent).not.toContain("·");
  });

  it("shows the year when there is one", async () => {
    await renderPage(list());
    expect(screen.getByText("1999")).toBeTruthy();
  });
});

describe("list menu", () => {
  it("opens the edit sheet with the current values", async () => {
    await renderPage(list({ trackSeparately: true }));

    fireEvent.click(screen.getByRole("button", { name: "List options" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit list" }));

    const dialog = screen.getByRole("dialog", {
      hidden: true,
      name: "Edit list",
    });
    expect(
      (within(dialog).getByLabelText("List name") as HTMLInputElement).value,
    ).toBe("Movie night");
    expect(
      (
        within(dialog).getByLabelText(
          "Track what you've watched separately in this list",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("asks before deleting, then calls deleteList (the action redirects)", async () => {
    await renderPage(list());

    fireEvent.click(screen.getByRole("button", { name: "List options" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete list" }));
    expect(actions.deleteList).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(actions.deleteList).toHaveBeenCalledWith("L1"));
  });

  it("can back out of deleting and shows a failure", async () => {
    vi.mocked(actions.deleteList).mockResolvedValueOnce({
      ok: false,
      error: "Could not delete.",
    });
    await renderPage(list());

    fireEvent.click(screen.getByRole("button", { name: "List options" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete list" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.deleteList).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "List options" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete list" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Could not delete.");
    // Still open on failure, with the message and the buttons to retry.
    expect(screen.getByRole("alert").textContent).toBe("Could not delete.");
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });
});
