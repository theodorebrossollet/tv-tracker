// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The show actions are only here because the movie menu borrows `CheckIcon`
// from status-sheet, which imports them.
vi.mock("@/app/actions", () => ({
  addToWatchlist: vi.fn(),
  pauseShow: vi.fn(),
  removeShow: vi.fn(),
  resumeShow: vi.fn(),
  stopShow: vi.fn(),
  removeMovie: vi.fn(async () => ({ ok: true })),
  setMovieStatus: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/rewatch-actions", () => ({
  resetMovieHistory: vi.fn(async () => ({ ok: true })),
  resetShowHistory: vi.fn(),
  startShowOver: vi.fn(),
}));

const { MovieStatusMenu } = await import("@/components/movie-status-menu");
const { resetMovieHistory } = await import("@/app/rewatch-actions");
const { setMovieStatus } = await import("@/app/actions");

import type { MovieStatus } from "@/lib/types";

type Reset = { pastWatches: number | null; watched: boolean };

const TEXT_WATCHED =
  "This permanently deletes your watch history and ratings for this movie. It goes back to your watchlist.";
const TEXT_NOT_WATCHED =
  "This permanently deletes your watch history and ratings for this movie.";

beforeEach(() => {
  vi.mocked(resetMovieHistory).mockReset();
  vi.mocked(resetMovieHistory).mockResolvedValue({ ok: true });
  vi.mocked(setMovieStatus).mockReset();
  vi.mocked(setMovieStatus).mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function openWith(
  resetHistory: Reset | null | undefined,
  status: MovieStatus | null = "watched",
) {
  render(
    <MovieStatusMenu
      movieId="603"
      title="The Matrix"
      status={status}
      variant="pill"
      resetHistory={resetHistory}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Change status for The Matrix" }),
  );
}

const resetRow = () => screen.getByRole("button", { name: /Reset history/ });
const confirmButton = () =>
  screen.getByRole("button", { name: "Reset history" }) as HTMLButtonElement;

function openConfirm(r: Reset = { pastWatches: 2, watched: true }) {
  openWith(r);
  fireEvent.click(resetRow());
}

describe("MovieStatusMenu reset history row", () => {
  it("shows only when the page passes resetHistory", () => {
    openWith({ pastWatches: 1, watched: true });
    expect(resetRow()).toBeTruthy();

    cleanup();
    openWith(undefined);
    expect(screen.queryByText(/Reset history/)).toBeNull();

    cleanup();
    openWith(null);
    expect(screen.queryByText(/Reset history/)).toBeNull();
  });

  it("is the last row, red, after the Remove row and a hairline", () => {
    openWith({ pastWatches: 1, watched: true });

    const remove = screen.getByRole("button", { name: /Remove/ });
    const row = resetRow();

    expect(row.parentElement).toBe(remove.parentElement);
    expect(row.nextElementSibling).toBeNull();
    expect(row.previousElementSibling!.tagName).toBe("HR");
    expect(row.className).toContain("text-danger");
    expect(remove.className).not.toContain("text-danger");
  });

  it("is reachable for an untracked movie, whose rows stay the usual ones", () => {
    openWith({ pastWatches: 2, watched: false }, null);

    expect(screen.getAllByText("Not tracked").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Watchlist/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Watched/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(resetRow().nextElementSibling).toBeNull();
  });

  it("confirms with the watchlist sentence for a watched movie", () => {
    openConfirm({ pastWatches: 2, watched: true });

    expect(screen.getByText("Reset history?")).toBeTruthy();
    expect(screen.getByText(TEXT_WATCHED)).toBeTruthy();
  });

  it("drops the watchlist sentence when the movie is not watched", () => {
    openWith({ pastWatches: 2, watched: false }, "watchlist");
    fireEvent.click(resetRow());

    expect(screen.getByText(TEXT_NOT_WATCHED)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/watchlist\./);
  });

  it("returns to the menu on Cancel and calls nothing", () => {
    openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(resetMovieHistory).not.toHaveBeenCalled();
    expect(screen.getByText("Track The Matrix as")).toBeTruthy();
    expect(screen.queryByText(/permanently deletes/)).toBeNull();
  });

  it("resets once with the movie id and closes on success", async () => {
    openConfirm();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(resetMovieHistory).toHaveBeenCalledTimes(1);
    expect(resetMovieHistory).toHaveBeenCalledWith("603");
  });

  it("disables the confirm and Cancel buttons while pending", async () => {
    let finish!: (value: { ok: true }) => void;
    vi.mocked(resetMovieHistory).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    openConfirm();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(confirmButton().disabled).toBe(true));
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    finish({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the confirmation and the message after a failure settles, and clears it on the next attempt", async () => {
    vi.mocked(resetMovieHistory).mockResolvedValueOnce({
      ok: false,
      error: "Nothing to reset.",
    });
    openConfirm();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    expect(screen.getByRole("alert").textContent).toBe("Nothing to reset.");
    expect(screen.getByText(TEXT_WATCHED)).toBeTruthy();

    let finish!: (value: { ok: true }) => void;
    vi.mocked(resetMovieHistory).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    finish({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("falls back to a generic message when the failure has none", async () => {
    vi.mocked(resetMovieHistory).mockResolvedValueOnce({ ok: false });
    openConfirm();
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /something went wrong/i,
      ),
    );
  });

  it("shows the menu, not the confirmation, when closed and reopened", async () => {
    vi.mocked(resetMovieHistory).mockResolvedValueOnce({
      ok: false,
      error: "Boom.",
    });
    openConfirm();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await waitFor(() => expect(confirmButton().disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(
      screen.getByRole("button", { name: "Change status for The Matrix" }),
    );
    expect(screen.getByText("Track The Matrix as")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/permanently deletes/)).toBeNull();
  });

  it("disables the other rows while a status change is pending", async () => {
    let finish!: (value: { ok: true }) => void;
    vi.mocked(setMovieStatus).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    openWith({ pastWatches: 1, watched: true });
    fireEvent.click(screen.getByRole("button", { name: /Not interested/ }));

    await waitFor(() =>
      expect((resetRow() as HTMLButtonElement).disabled).toBe(true),
    );

    finish({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
