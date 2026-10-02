// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/action-result";

const setMovieStatus = vi.fn<(id: string, s: string) => Promise<ActionResult>>();
const addMovieToWatchlist = vi.fn<(id: string) => Promise<ActionResult>>();
const removeMovie = vi.fn<(id: string) => Promise<ActionResult>>();

vi.mock("@/app/actions", () => ({
  setMovieStatus: (id: string, s: string) => setMovieStatus(id, s),
  addMovieToWatchlist: (id: string) => addMovieToWatchlist(id),
  removeMovie: (id: string) => removeMovie(id),
}));

const { MarkMovieWatchedButton } = await import(
  "@/components/mark-movie-watched-button"
);
const { MovieAddButton } = await import("@/components/movie-add-button");

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

/** A promise the test settles by hand, to observe the pending state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("MarkMovieWatchedButton", () => {
  it("calls setMovieStatus(movieId, 'watched') and is disabled while pending", async () => {
    const gate = deferred<ActionResult>();
    setMovieStatus.mockReturnValue(gate.promise);
    render(<MarkMovieWatchedButton movieId="603" />);

    const button = screen.getByRole("button", { name: /mark watched/i });
    fireEvent.click(button);

    expect(setMovieStatus).toHaveBeenCalledWith("603", "watched");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));

    gate.resolve({ ok: true });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it("keeps a failure message on screen after the action settles", async () => {
    setMovieStatus.mockResolvedValue({ ok: false, error: "That change isn't available." });
    render(<MarkMovieWatchedButton movieId="603" />);

    const button = screen.getByRole("button", { name: /mark watched/i });
    fireEvent.click(button);

    await screen.findByText("That change isn't available.");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText("That change isn't available.")).toBeTruthy();
  });

  it("clears an earlier error when a later attempt succeeds", async () => {
    setMovieStatus.mockResolvedValueOnce({ ok: false, error: "x" });
    setMovieStatus.mockResolvedValueOnce({ ok: true });
    render(<MarkMovieWatchedButton movieId="603" />);

    const button = screen.getByRole("button", { name: /mark watched/i });
    fireEvent.click(button);
    await screen.findByText("x");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByText("x")).toBeNull());
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText("x")).toBeNull();
  });
});

describe("MovieAddButton (full)", () => {
  it("keeps a failure message on screen and reverts the optimistic state", async () => {
    addMovieToWatchlist.mockResolvedValue({ ok: false, error: "Too many new movies." });
    render(<MovieAddButton movieId="603" status={null} variant="full" />);

    const button = screen.getByRole("button", { name: "Add to watchlist" });
    fireEvent.click(button);

    expect(addMovieToWatchlist).toHaveBeenCalledWith("603");
    await screen.findByText("Too many new movies.");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    expect(screen.getByText("Too many new movies.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to watchlist" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  it("clears the error on the next attempt", async () => {
    addMovieToWatchlist.mockResolvedValueOnce({ ok: false, error: "nope" });
    addMovieToWatchlist.mockResolvedValueOnce({ ok: true });
    render(<MovieAddButton movieId="603" status={null} variant="full" />);

    const button = screen.getByRole("button", { name: "Add to watchlist" });
    fireEvent.click(button);
    await screen.findByText("nope");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByText("nope")).toBeNull());
  });
});
