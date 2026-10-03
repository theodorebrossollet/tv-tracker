// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/action-result";
import type { CardDetails, DeckCard, DeckFilters } from "@/lib/discover-types";

const addToWatchlist = vi.fn<(id: string) => Promise<ActionResult>>();
const addMovieToWatchlist = vi.fn<(id: string) => Promise<ActionResult>>();
const dismissSuggestion =
  vi.fn<(kind: string, id: string) => Promise<ActionResult>>();
const loadCardDetails =
  vi.fn<
    (kind: string, id: string) => Promise<ActionResult & { details?: CardDetails }>
  >();
const replace = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/actions", () => ({
  addToWatchlist: (id: string) => addToWatchlist(id),
  addMovieToWatchlist: (id: string) => addMovieToWatchlist(id),
}));
vi.mock("@/app/discover-actions", () => ({
  dismissSuggestion: (kind: string, id: string) => dismissSuggestion(kind, id),
  loadCardDetails: (kind: string, id: string) => loadCardDetails(kind, id),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace, push: vi.fn() }),
}));

const { DiscoverDeck } = await import("@/components/discover-deck");
const { DiscoverIconButton } = await import(
  "@/components/discover-icon-button"
);

const OWN_MOVIE: DeckCard = {
  source: "own",
  kind: "movie",
  id: "603",
  title: "The Matrix",
  posterPath: "/matrix.jpg",
  year: "1999",
};
const OWN_SHOW: DeckCard = {
  source: "own",
  kind: "show",
  id: "1396",
  title: "Breaking Bad",
  posterPath: null,
  year: "2008",
};
const REC_SHOW: DeckCard = {
  source: "recommended",
  kind: "show",
  id: "95396",
  title: "Severance",
  posterPath: "/sev.jpg",
  year: "2022",
  becauseTitle: "Dark",
  becauseRating: 8.25,
};
const REC_MOVIE: DeckCard = {
  source: "recommended",
  kind: "movie",
  id: "27205",
  title: "Inception",
  posterPath: null,
  year: null,
  becauseTitle: "Interstellar",
  becauseRating: 9,
};

const ANY: DeckFilters = { kind: "any", short: false, listId: null };
const LISTS = [
  { id: "list-a", name: "Weekend" },
  { id: "list-b", name: "With Sam" },
];

function deck(
  props: Partial<{
    cards: DeckCard[];
    seedCount: number;
    recommendationsUnavailable: boolean;
    filters: DeckFilters;
    lists: Array<{ id: string; name: string }>;
  }> = {},
) {
  return render(
    <DiscoverDeck
      cards={props.cards ?? [REC_SHOW, OWN_MOVIE]}
      seedCount={props.seedCount ?? 5}
      recommendationsUnavailable={props.recommendationsUnavailable ?? false}
      filters={props.filters ?? ANY}
      lists={props.lists ?? LISTS}
    />,
  );
}

const currentTitle = () =>
  screen.getByRole("heading", { level: 2 }).textContent;
const notThisOne = () => screen.getByRole("button", { name: "Not this one" });
const addButton = () =>
  screen.getByRole("button", { name: "Add to watchlist" });
const pickButton = () => screen.getByRole("button", { name: "Pick this one" });
const card = () => screen.getByTestId("current-card");

function drag(dx: number, dy: number) {
  const el = card();
  fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 100 }] });
  // Two steps, as a finger would: the first decides the axis, the second moves.
  fireEvent.touchMove(el, {
    touches: [{ clientX: 100 + dx / 2, clientY: 100 + dy / 2 }],
  });
  fireEvent.touchMove(el, {
    touches: [{ clientX: 100 + dx, clientY: 100 + dy }],
  });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: 100 + dx, clientY: 100 + dy }] });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  addToWatchlist.mockResolvedValue({ ok: true });
  addMovieToWatchlist.mockResolvedValue({ ok: true });
  dismissSuggestion.mockResolvedValue({ ok: true });
  loadCardDetails.mockResolvedValue({
    ok: true,
    details: {
      overview: "Office workers have their memories split.",
      genres: "Drama, Mystery",
      runtime: null,
      cast: [
        { id: 1, name: "Adam Scott", character: "Mark" },
        { id: 2, name: "Britt Lower", character: null },
      ],
      trailerKey: "abc_DEF-123",
      providers: ["Apple TV+"],
    },
  });
});
afterEach(cleanup);

describe("filters", () => {
  it("reflects the current filters", () => {
    deck({ filters: { kind: "movie", short: true, listId: "list-b" } });
    expect(
      screen.getByRole("button", { name: "Movie" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Any" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Under 2h" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (screen.getByRole("combobox", { name: "List" }) as HTMLSelectElement)
        .value,
    ).toBe("list-b");
  });

  it("chips replace the URL with kind, keeping the other params", () => {
    deck({ filters: { kind: "any", short: true, listId: "list-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(replace).toHaveBeenCalledWith(
      "/discover?kind=show&short=1&list=list-a",
      { scroll: false },
    );
  });

  it("omits defaults: Any drops kind", () => {
    deck({ filters: { kind: "movie", short: false, listId: null } });
    fireEvent.click(screen.getByRole("button", { name: "Any" }));
    expect(replace).toHaveBeenCalledWith("/discover", { scroll: false });
  });

  it("toggles Under 2h", () => {
    deck();
    fireEvent.click(screen.getByRole("button", { name: "Under 2h" }));
    expect(replace).toHaveBeenLastCalledWith("/discover?short=1", {
      scroll: false,
    });
  });

  it("the list select sets and clears list", () => {
    deck({ filters: { kind: "show", short: false, listId: "list-a" } });
    const select = screen.getByRole("combobox", { name: "List" });
    expect(
      Array.from((select as HTMLSelectElement).options).map((o) => o.text),
    ).toEqual(["All to-watch", "Weekend", "With Sam"]);

    fireEvent.change(select, { target: { value: "list-b" } });
    expect(replace).toHaveBeenLastCalledWith("/discover?kind=show&list=list-b", {
      scroll: false,
    });

    fireEvent.change(select, { target: { value: "" } });
    expect(replace).toHaveBeenLastCalledWith("/discover?kind=show", {
      scroll: false,
    });
  });
});

describe("the current card", () => {
  it("shows a recommendation with its reason and a peeking next card", () => {
    deck();
    expect(currentTitle()).toBe("Severance");
    expect(card().textContent).toContain("2022");
    expect(card().textContent).toContain(
      "Recommended · because you rated Dark ★8.3",
    );
    expect(screen.getByAltText("Poster for Severance")).toBeTruthy();
    expect(screen.getByTestId("next-card").textContent).toContain("The Matrix");
    expect(addButton()).toBeTruthy();
    expect(notThisOne()).toBeTruthy();
  });

  it("formats an integer seed rating without a decimal", () => {
    deck({ cards: [REC_MOVIE] });
    expect(card().textContent).toContain(
      "Recommended · because you rated Interstellar ★9",
    );
    expect(card().textContent).not.toContain("★9.0");
  });

  it("tags an own card by where it came from", () => {
    deck({ cards: [OWN_MOVIE] });
    expect(card().textContent).toContain("On your watchlist");
    expect(pickButton()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add to watchlist" })).toBeNull();
    cleanup();

    deck({ cards: [OWN_MOVIE], filters: { ...ANY, listId: "list-a" } });
    expect(card().textContent).toContain("On this list");
  });

  it("never prints NaN or undefined", () => {
    deck({
      cards: [REC_MOVIE, { ...OWN_SHOW, year: null }],
      seedCount: 1,
      recommendationsUnavailable: true,
    });
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/NaN|undefined|null/);
  });
});

describe("✓ on a recommendation", () => {
  it("adds a show by kind, then advances", async () => {
    deck();
    fireEvent.click(addButton());
    await waitFor(() => expect(currentTitle()).toBe("The Matrix"));
    expect(addToWatchlist).toHaveBeenCalledWith("95396");
    expect(addMovieToWatchlist).not.toHaveBeenCalled();
  });

  it("adds a movie by kind", async () => {
    deck({ cards: [REC_MOVIE, OWN_SHOW] });
    fireEvent.click(addButton());
    await waitFor(() => expect(currentTitle()).toBe("Breaking Bad"));
    expect(addMovieToWatchlist).toHaveBeenCalledWith("27205");
    expect(addToWatchlist).not.toHaveBeenCalled();
  });

  it("does not advance on failure, and the error outlives the request", async () => {
    addToWatchlist.mockResolvedValue({ ok: false, error: "Couldn't add it." });
    deck();
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Couldn't add it."),
    );
    // Settled: buttons are usable again, the card has not moved, and the
    // message is still there.
    await waitFor(() => expect(addButton().hasAttribute("disabled")).toBe(false));
    expect(currentTitle()).toBe("Severance");
    expect(screen.getByRole("alert").textContent).toBe("Couldn't add it.");
  });

  it("acts once on a double tap while pending", async () => {
    const gate = deferred<ActionResult>();
    addToWatchlist.mockReturnValue(gate.promise);
    deck({ cards: [REC_SHOW, REC_MOVIE, OWN_MOVIE] });

    fireEvent.click(addButton());
    fireEvent.click(addButton());
    // A swipe while pending is ignored too.
    drag(200, 0);

    expect(addButton().hasAttribute("disabled")).toBe(true);
    expect(notThisOne().hasAttribute("disabled")).toBe(true);
    expect(addToWatchlist).toHaveBeenCalledTimes(1);
    expect(addMovieToWatchlist).not.toHaveBeenCalled();

    await act(async () => gate.resolve({ ok: true }));
    await waitFor(() => expect(currentTitle()).toBe("Inception"));
    expect(addToWatchlist).toHaveBeenCalledTimes(1);
  });
});

describe("✓ on an own card", () => {
  it("never calls an add action and shows Tonight with an Open link", () => {
    deck({ cards: [OWN_MOVIE, OWN_SHOW] });
    fireEvent.click(pickButton());

    expect(addToWatchlist).not.toHaveBeenCalled();
    expect(addMovieToWatchlist).not.toHaveBeenCalled();
    expect(dismissSuggestion).not.toHaveBeenCalled();
    expect(screen.getByText("Tonight: The Matrix")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open" }).getAttribute("href"),
    ).toBe("/movie/603");
  });

  it("links a show to its show page, and Pick another moves on", () => {
    deck({ cards: [OWN_SHOW, OWN_MOVIE] });
    fireEvent.click(pickButton());
    expect(
      screen.getByRole("link", { name: "Open" }).getAttribute("href"),
    ).toBe("/show/1396");

    fireEvent.click(screen.getByRole("button", { name: "Pick another" }));
    expect(currentTitle()).toBe("The Matrix");
  });
});

describe("✕", () => {
  it("dismisses a recommendation, then advances", async () => {
    deck();
    fireEvent.click(notThisOne());
    await waitFor(() => expect(currentTitle()).toBe("The Matrix"));
    expect(dismissSuggestion).toHaveBeenCalledWith("show", "95396");
  });

  it("does not advance when the dismiss fails", async () => {
    dismissSuggestion.mockResolvedValue({ ok: false, error: "Too many." });
    deck();
    fireEvent.click(notThisOne());
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Too many."),
    );
    await waitFor(() =>
      expect(notThisOne().hasAttribute("disabled")).toBe(false),
    );
    expect(currentTitle()).toBe("Severance");
  });

  it("only advances on an own card", () => {
    deck({ cards: [OWN_MOVIE, OWN_SHOW] });
    fireEvent.click(notThisOne());
    expect(currentTitle()).toBe("Breaking Bad");
    expect(dismissSuggestion).not.toHaveBeenCalled();
    expect(addToWatchlist).not.toHaveBeenCalled();
    expect(addMovieToWatchlist).not.toHaveBeenCalled();
  });
});

describe("swiping", () => {
  it("right on a recommendation adds, like ✓", async () => {
    deck();
    drag(150, 5);
    await waitFor(() => expect(currentTitle()).toBe("The Matrix"));
    expect(addToWatchlist).toHaveBeenCalledWith("95396");
  });

  it("left on a recommendation dismisses, like ✕", async () => {
    deck();
    drag(-150, 0);
    await waitFor(() => expect(currentTitle()).toBe("The Matrix"));
    expect(dismissSuggestion).toHaveBeenCalledWith("show", "95396");
  });

  it("right on an own card shows Tonight and calls nothing", () => {
    deck({ cards: [OWN_MOVIE] });
    drag(150, 0);
    expect(screen.getByText("Tonight: The Matrix")).toBeTruthy();
    expect(addMovieToWatchlist).not.toHaveBeenCalled();
    expect(addToWatchlist).not.toHaveBeenCalled();
  });

  it("left on an own card advances and calls nothing", () => {
    deck({ cards: [OWN_MOVIE, OWN_SHOW] });
    drag(-150, 0);
    expect(currentTitle()).toBe("Breaking Bad");
    expect(dismissSuggestion).not.toHaveBeenCalled();
  });

  it("a short drag springs back", () => {
    deck();
    drag(40, 0);
    expect(currentTitle()).toBe("Severance");
    expect(addToWatchlist).not.toHaveBeenCalled();
    expect(dismissSuggestion).not.toHaveBeenCalled();
  });

  it("a vertical drag never swipes, even if it drifts far sideways later", () => {
    deck();
    const el = card();
    fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 102, clientY: 160 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 400, clientY: 170 }] });
    expect(el.style.transform).not.toContain("translateX(300");
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 400, clientY: 170 }] });

    expect(currentTitle()).toBe("Severance");
    expect(addToWatchlist).not.toHaveBeenCalled();
    expect(dismissSuggestion).not.toHaveBeenCalled();
  });

  it("the card follows the finger and leans", () => {
    deck();
    const el = card();
    fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 150, clientY: 102 }] });
    expect(el.style.transform).toBe("translateX(50px) rotate(5deg)");
  });

  it("allows vertical scrolling on the card", () => {
    deck();
    expect(card().className).toContain("touch-pan-y");
  });
});

describe("details", () => {
  it("loads nothing until a card is opened", () => {
    deck();
    expect(loadCardDetails).not.toHaveBeenCalled();
  });

  it("loads once per card and shows what came back", async () => {
    deck();
    const toggle = screen.getByRole("button", { name: "Details" });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(
        screen.getByText("Office workers have their memories split."),
      ).toBeTruthy(),
    );
    expect(loadCardDetails).toHaveBeenCalledWith("show", "95396");
    expect(card().textContent).toContain("Drama, Mystery");
    expect(card().textContent).toContain("Adam Scott");
    expect(card().textContent).toContain("Britt Lower");
    expect(card().textContent).toContain("Apple TV+");
    expect(
      screen.getByRole("button", { name: "Play trailer: Severance" }),
    ).toBeTruthy();

    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(loadCardDetails).toHaveBeenCalledTimes(1);
  });

  it("renders no streaming line when there are no providers", async () => {
    loadCardDetails.mockResolvedValue({
      ok: true,
      details: {
        overview: "A thief who steals secrets.",
        genres: null,
        runtime: 148,
        cast: [],
        trailerKey: null,
        providers: [],
      },
    });
    deck({ cards: [REC_MOVIE] });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    await waitFor(() =>
      expect(screen.getByText("A thief who steals secrets.")).toBeTruthy(),
    );
    expect(card().textContent).not.toMatch(/Streaming/);
    expect(card().textContent).not.toMatch(/NaN|undefined|null/);
  });

  it("a failure is a quiet line and swiping still works", async () => {
    loadCardDetails.mockResolvedValue({ ok: false, error: "Nope." });
    deck();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    await waitFor(() =>
      expect(screen.getByText("Couldn't load details")).toBeTruthy(),
    );
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(addButton());
    await waitFor(() => expect(currentTitle()).toBe("The Matrix"));
  });
});

describe("notices and empty states", () => {
  it("asks for more ratings once when there are too few seeds", () => {
    deck({ seedCount: 2 });
    expect(
      screen.getAllByText("Rate a few more titles to get recommendations"),
    ).toHaveLength(1);
  });

  it("says nothing about seeds when there are enough", () => {
    deck({ seedCount: 3 });
    expect(
      screen.queryByText("Rate a few more titles to get recommendations"),
    ).toBeNull();
  });

  it("says when recommendations are unavailable", () => {
    deck({ recommendationsUnavailable: true });
    expect(
      screen.getByText("Recommendations are unavailable right now."),
    ).toBeTruthy();
  });

  it("an empty deck offers a refresh", () => {
    deck({ cards: [] });
    expect(screen.getByText("You've seen them all")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("an exhausted deck says so too", () => {
    deck({ cards: [OWN_MOVIE] });
    fireEvent.click(notThisOne());
    expect(screen.getByText("You've seen them all")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });
});

describe("DiscoverIconButton", () => {
  it("links to /discover with a name and a 44px hit area", () => {
    render(<DiscoverIconButton />);
    const link = screen.getByRole("link", { name: "Discover" });
    expect(link.getAttribute("href")).toBe("/discover");
    expect(link.className).toContain("size-11");
    expect(link.querySelector("span")?.className).toContain("size-10");
    expect(link.querySelector("svg")).toBeTruthy();
  });
});

describe("the dashboard header", () => {
  it("puts Discover right before Search, in one group", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/app/page.tsx", "utf8");
    expect(source).toMatch(
      /<div className="flex[^"]*">\s*<DiscoverIconButton \/>\s*<SearchIconButton \/>\s*<\/div>/,
    );
  });
});
