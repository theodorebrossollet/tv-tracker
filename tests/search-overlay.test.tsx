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

vi.mock("@/app/actions", () => ({
  searchSuggestions: (query: string) => searchSuggestions(query),
  addToWatchlist: vi.fn(async () => ({ ok: true })),
  removeShow: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { SearchOverlay } = await import("@/components/search-overlay");

const RESULT = {
  id: "95396",
  name: "Severance",
  posterPath: null,
  firstAirYear: "2022",
  status: null,
};

beforeEach(() => {
  searchSuggestions.mockReset();
  searchSuggestions.mockResolvedValue({ results: [RESULT] });
  push.mockReset();
});

afterEach(cleanup);

/** Types into the controlled field. */
function type(value: string) {
  fireEvent.change(screen.getByLabelText("Show title"), { target: { value } });
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

    expect((screen.getByLabelText("Show title") as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("names the query when nothing matches", async () => {
    searchSuggestions.mockResolvedValue({ results: [] });
    open();

    type("zzzz");

    // The query is echoed back so a typo is visible as a typo rather than as
    // "this show doesn't exist".
    expect(await screen.findByText(/No shows found for/)).toBeTruthy();
    expect(screen.getByText(/zzzz/)).toBeTruthy();
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

    expect((screen.getByLabelText("Show title") as HTMLInputElement).value).toBe(
      "severance",
    );
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
