// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sheet's rows map to these; what each one does is covered against a real
// database in status-transitions.test.ts. This file is about what gets drawn.
vi.mock("@/app/actions", () => ({
  addToWatchlist: vi.fn(async () => ({ ok: true })),
  pauseShow: vi.fn(async () => ({ ok: true })),
  removeShow: vi.fn(async () => ({ ok: true })),
  resumeShow: vi.fn(async () => ({ ok: true })),
  stopShow: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/rewatch-actions", () => ({
  startShowOver: vi.fn(async () => ({ ok: true })),
}));

const { StatusMenu } = await import("@/components/status-sheet");
const { startShowOver } = await import("@/app/rewatch-actions");

import type { TrackStatus } from "@/lib/types";

afterEach(cleanup);

/** Opens the sheet for a show in the given state. */
function openSheet(status: TrackStatus | null, finished = false) {
  render(
    <StatusMenu
      showId="101"
      name="Severance"
      status={status}
      finished={finished}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Change status for Severance" }),
  );
}

describe("which rows the sheet offers", () => {
  it("names the show it is about", () => {
    openSheet("watching");

    expect(screen.getByText("Track Severance as")).toBeTruthy();
  });

  it("offers a watching show the two ways to set it aside", () => {
    openSheet("watching");

    expect(screen.getByRole("button", { name: /Paused/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Stopped/ })).toBeTruthy();
  });

  it("offers a watchlist show nothing but removal", () => {
    // The actions refuse every other move from here — `setAside` requires a
    // show that has been started. Drawing those rows anyway is what the
    // handoff's full matrix would have done, and they would do nothing.
    openSheet("watchlist");

    expect(screen.queryByRole("button", { name: /Paused/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Stopped/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Not tracked/ })).toBeTruthy();
  });

  it("explains the promotion rule exactly where Watching is missing", () => {
    openSheet("watchlist");
    expect(
      screen.getByText(/moves to Watching when you mark an episode/),
    ).toBeTruthy();

    cleanup();

    openSheet("watching");
    expect(
      screen.queryByText(/moves to Watching when you mark an episode/),
    ).toBeNull();
  });
});

describe("what the checked row says", () => {
  it("reads Finished for a fully-watched show, not Watching", () => {
    // Finished is derived and never stored, so the status underneath is still
    // "watching" — and "shows up on your dashboard" is false for a show that
    // buckets into the Archive.
    openSheet("watching", true);

    expect(screen.getByText("Finished")).toBeTruthy();
    expect(screen.getByText("Every aired episode watched")).toBeTruthy();
  });

  it("reads the stored status otherwise", () => {
    openSheet("paused");

    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.queryByText("Finished")).toBeNull();
  });
});

describe("start over", () => {
  const startOver = { watched: 7, aired: 10, runNumber: 2 };

  beforeEach(() => {
    vi.mocked(startShowOver).mockReset();
    vi.mocked(startShowOver).mockResolvedValue({ ok: true });
  });

  function openWith(over: typeof startOver | { watched: number; aired: number; runNumber: null } | null | undefined) {
    render(
      <StatusMenu
        showId="101"
        name="Severance"
        status="watching"
        startOver={over}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Change status for Severance" }),
    );
  }

  function openConfirm(over = startOver as Parameters<typeof openWith>[0]) {
    openWith(over);
    fireEvent.click(screen.getByRole("button", { name: /Start over/ }));
  }

  it("offers Start over only when the page passes startOver", () => {
    openWith(startOver);
    expect(screen.getByRole("button", { name: /Start over/ })).toBeTruthy();

    cleanup();
    openWith(undefined);
    expect(screen.queryByText(/Start over/)).toBeNull();

    cleanup();
    openWith(null);
    expect(screen.queryByText(/Start over/)).toBeNull();
  });

  it("confirms with the numbers and the run it is kept as", () => {
    openConfirm();

    expect(
      screen.getByText(
        /Your current progress \(7 of 10 episodes\) is kept as Run 2\. This show goes back to the start\. This can't be undone in this version\./,
      ),
    ).toBeTruthy();
  });

  it("says a past run when the run number is unknown", () => {
    openConfirm({ watched: 7, aired: 10, runNumber: null });

    expect(
      screen.getByText(/\(7 of 10 episodes\) is kept as a past run\./),
    ).toBeTruthy();
    expect(screen.queryByText(/Run \d/)).toBeNull();
  });

  it("returns to the menu on Cancel and calls nothing", () => {
    openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(startShowOver).not.toHaveBeenCalled();
    expect(screen.getByText("Track Severance as")).toBeTruthy();
    expect(screen.queryByText(/is kept as/)).toBeNull();
  });

  it("starts over once with the show id and closes on success", async () => {
    openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(startShowOver).toHaveBeenCalledTimes(1);
    expect(startShowOver).toHaveBeenCalledWith("101");
  });

  it("disables the confirm button while pending", async () => {
    let finish!: (value: { ok: true }) => void;
    vi.mocked(startShowOver).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Start over" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );

    finish({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the confirmation and the message after a failure, and clears it on the next attempt", async () => {
    vi.mocked(startShowOver).mockResolvedValueOnce({
      ok: false,
      error: "Nothing to start over.",
    });

    openConfirm();
    const confirm = () =>
      screen.getByRole("button", { name: "Start over" }) as HTMLButtonElement;
    fireEvent.click(confirm());

    // Wait for the transition to settle (button re-enabled), then assert: the
    // message must survive it.
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await waitFor(() => expect(confirm().disabled).toBe(false));
    expect(screen.getByRole("alert").textContent).toBe("Nothing to start over.");
    expect(screen.getByText(/is kept as Run 2/)).toBeTruthy();

    let finish!: (value: { ok: true }) => void;
    vi.mocked(startShowOver).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(confirm());

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    finish({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
