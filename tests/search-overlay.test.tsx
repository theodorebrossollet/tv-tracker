// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchSuggestions = vi.fn();
const push = vi.fn();
const addMovieToWatchlist = vi.fn(async (id: string) => ({ ok: Boolean(id) }));

vi.mock("@/app/actions", () => ({
  searchSuggestions: (query: string) => searchSuggestions(query),
  addToWatchlist: vi.fn(async () => ({ ok: true })),
  removeShow: vi.fn(async () => ({ ok: true })),
  addMovieToWatchlist: (id: string) => addMovieToWatchlist(id),
  removeMovie: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { SearchOverlay } = await import("@/components/search-overlay");

const RESULT = {
  kind: "tv" as const,
  id: "95396",
  name: "Severance",
  posterPath: null,
  year: "2022",
  status: null,
};

beforeEach(() => {
  searchSuggestions.mockReset();
  searchSuggestions.mockResolvedValue({ results: [RESULT] });
  push.mockReset();
  addMovieToWatchlist.mockClear();
});

afterEach(cleanup);

/** Types into the controlled field. */
function type(value: string) {
  fireEvent.change(screen.getByLabelText("Search query"), {
    target: { value },
  });
}

function open(props: Partial<Parameters<typeof SearchOverlay>[0]> = {}) {
  return render(
    <SearchOverlay
      onClose={vi.fn()}
      recent={[]}
      onRemember={vi.fn()}
      {...props}
    />,
  );
}

describe("the field", () => {
  it("offers a way to clear itself only once there is something to clear", async () => {
    open();

    expect(screen.queryByLabelText("Clear search")).toBeNull();

    type("sev");
    const clear = screen.getByLabelText("Clear search");

    fireEvent.click(clear);

    expect(
      (screen.getByLabelText("Search query") as HTMLInputElement).value,
    ).toBe("");
  });

  it("names the query when nothing matches", async () => {
    searchSuggestions.mockResolvedValue({ results: [] });
    open();

    type("zzzz");

    // The query is echoed back so a typo is visible as a typo rather than as
    // "this show doesn't exist".
    expect(await screen.findByText(/No results for/)).toBeTruthy();
    expect(screen.getByText(/zzzz/)).toBeTruthy();
  });
});

const MOVIE = {
  kind: "movie" as const,
  id: "95396",
  name: "Severance: The Movie",
  posterPath: null,
  year: null,
  status: null,
};

describe("shows and movies together", () => {
  it("badges each row and renders a tv and a movie sharing an id", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    searchSuggestions.mockResolvedValue({ results: [RESULT, MOVIE] });
    open();

    type("sev");

    expect(await screen.findByText("Severance: The Movie")).toBeTruthy();
    expect(screen.getByText("Severance")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // The kind is an icon badge on the poster, not text beside the title.
    expect(screen.getByRole("img", { name: "TV show" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Movie" })).toBeTruthy();
    expect(screen.queryByText("TV")).toBeNull();
    expect(screen.queryByText("Movie")).toBeNull();
    expect(screen.getByText("Year unknown")).toBeTruthy();
    expect(
      error.mock.calls.some((call) => String(call[0]).includes("key")),
    ).toBe(false);
    error.mockRestore();
  });

  it("opens each kind on its own route", async () => {
    searchSuggestions.mockResolvedValue({ results: [RESULT, MOVIE] });
    open();

    type("sev");
    fireEvent.click(await screen.findByText("Severance: The Movie"));
    expect(push).toHaveBeenLastCalledWith("/movie/95396");

    fireEvent.click(screen.getByText("Severance"));
    expect(push).toHaveBeenLastCalledWith("/show/95396");
  });

  it("adds a movie through the movie action, not the show one", async () => {
    searchSuggestions.mockResolvedValue({ results: [MOVIE] });
    open();

    type("sev");
    await screen.findByText("Severance: The Movie");
    fireEvent.click(screen.getByRole("button", { name: "Add to watchlist" }));

    await waitFor(() => {
      expect(addMovieToWatchlist).toHaveBeenCalledWith("95396");
    });
  });
});

describe("recent searches", () => {
  it("shows them only while the field is empty", async () => {
    open({ recent: ["severance"] });

    expect(screen.getByRole("button", { name: "severance" })).toBeTruthy();

    type("the");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "severance" })).toBeNull();
    });
  });

  it("re-runs the search when one is tapped", async () => {
    open({ recent: ["severance"] });

    fireEvent.click(screen.getByRole("button", { name: "severance" }));

    expect(
      (screen.getByLabelText("Search query") as HTMLInputElement).value,
    ).toBe("severance");
    await waitFor(() => {
      expect(searchSuggestions).toHaveBeenCalledWith("severance");
    });
  });

  it("remembers a search that went somewhere, not every prefix of it", async () => {
    // Recorded on the way out rather than as you type — otherwise the chips
    // fill up with "s", "se", "sev" and the feature is worse than nothing.
    const onRemember = vi.fn();
    open({ onRemember });

    type("severance");
    const result = await screen.findByText("Severance");

    expect(onRemember).not.toHaveBeenCalled();

    fireEvent.click(result);

    expect(onRemember).toHaveBeenCalledWith("severance");
    expect(push).toHaveBeenCalledWith("/show/95396");
  });
});

describe("the field's font size", () => {
  it("is 16px, because anything smaller makes iOS zoom", () => {
    // Not a style preference. Safari zooms the viewport when a focused form
    // control is under 16px, which crops the page and leaves the reader
    // pinching back out — reported from a phone, not theorised.
    //
    // Asserted on the class because that is where the decision lives: the
    // handoff specifies 15px, so without something failing here this reverts
    // the next time someone matches the spec.
    open();

    expect(screen.getByLabelText("Search query").className).toContain(
      "text-base",
    );
  });
});
