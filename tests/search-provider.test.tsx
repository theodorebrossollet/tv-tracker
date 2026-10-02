// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  searchSuggestions: vi.fn(async () => ({ results: [] })),
  addToWatchlist: vi.fn(),
  removeShow: vi.fn(),
  addMovieToWatchlist: vi.fn(),
  removeMovie: vi.fn(),
}));
vi.mock("@/app/list-actions", () => ({ addToList: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { SearchProvider, useSearch } = await import(
  "@/components/search-provider"
);

afterEach(cleanup);

function Controls() {
  const { open, openForList, isOpen } = useSearch();
  return (
    <>
      <button onClick={open}>open</button>
      <button onClick={() => openForList({ id: "l1", name: "Family" })}>
        open for list
      </button>
      <span>{isOpen ? "is open" : "is closed"}</span>
    </>
  );
}

function setup() {
  render(
    <SearchProvider>
      <Controls />
    </SearchProvider>,
  );
}

describe("SearchProvider", () => {
  it("opens the normal mode with open()", () => {
    setup();
    fireEvent.click(screen.getByText("open"));

    expect(screen.getByText("is open")).toBeTruthy();
    expect(screen.queryByText(/Adding to/)).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("opens add mode with openForList()", () => {
    setup();
    fireEvent.click(screen.getByText("open for list"));

    expect(screen.getByText("is open")).toBeTruthy();
    expect(screen.getByText("Adding to Family")).toBeTruthy();
  });

  it("forgets the target on close", () => {
    setup();
    fireEvent.click(screen.getByText("open for list"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("is closed")).toBeTruthy();

    fireEvent.click(screen.getByText("open"));
    expect(screen.queryByText(/Adding to/)).toBeNull();
  });
});
