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
  resetShowHistory: vi.fn(async () => ({ ok: true })),
}));

const { StatusMenu } = await import("@/components/status-sheet");
const { startShowOver, resetShowHistory } = await import(
  "@/app/rewatch-actions"
);

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

describe("start over row placement", () => {
  const startOver = { watched: 7, aired: 10, runNumber: 2 };

  function open(status: TrackStatus | null) {
    render(
      <StatusMenu
        showId="101"
        name="Severance"
        status={status}
        startOver={startOver}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Change status for Severance" }),
    );
  }

  it("is the last row, straight after Not tracked, with no separator between", () => {
    open("watching");

    const notTracked = screen.getByRole("button", { name: /Not tracked/ });
    const start = screen.getByRole("button", { name: /Start over/ });

    expect(notTracked.nextElementSibling).toBe(start);
    expect(start.nextElementSibling).toBeNull();
    // The one hairline left in the group sits above Not tracked.
    expect(start.parentElement!.querySelectorAll("hr")).toHaveLength(1);
  });

  it("sits in the same group as the other rows", () => {
    open("watching");

    expect(
      screen.getByRole("button", { name: /Start over/ }).parentElement,
    ).toBe(screen.getByRole("button", { name: /Not tracked/ }).parentElement);
  });

  it("carries an outlined, decorative icon in the same tile as the other rows", () => {
    open("watching");

    const tile = (name: RegExp) =>
      screen.getByRole("button", { name }).querySelector("span");
    const start = tile(/Start over/)!;
    const other = tile(/Not tracked/)!;

    const svg = start.querySelector("svg")!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(start.className).toBe(other.className);
  });

  it("keeps its label and hint", () => {
    open("watching");

    expect(screen.getByText("Start over")).toBeTruthy();
    expect(
      screen.getByText("Keep this run as a past run and begin again"),
    ).toBeTruthy();
  });

  it("follows the status rows without a separator when the show is untracked", () => {
    open(null);

    const rows = screen
      .getByRole("button", { name: /Start over/ })
      .parentElement!;
    expect(rows.querySelectorAll("hr")).toHaveLength(0);
    expect(rows.lastElementChild).toBe(
      screen.getByRole("button", { name: /Start over/ }),
    );
  });
});

describe("reset history", () => {
  const reset = { watched: 7, pastRuns: 2 };
  type Reset = { watched: number; pastRuns: number | null };

  beforeEach(() => {
    vi.mocked(resetShowHistory).mockReset();
    vi.mocked(resetShowHistory).mockResolvedValue({ ok: true });
    vi.mocked(startShowOver).mockReset();
    vi.mocked(startShowOver).mockResolvedValue({ ok: true });
  });

  function openWith(
    resetHistory: Reset | null | undefined,
    extra: { startOver?: boolean; status?: TrackStatus | null } = {},
  ) {
    render(
      <StatusMenu
        showId="101"
        name="Severance"
        status={extra.status === undefined ? "watching" : extra.status}
        startOver={
          extra.startOver ? { watched: 7, aired: 10, runNumber: 2 } : null
        }
        resetHistory={resetHistory}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Change status for Severance" }),
    );
  }

  function openConfirm(r: Reset = reset) {
    openWith(r);
    fireEvent.click(screen.getByRole("button", { name: /Reset history/ }));
  }

  const confirmButton = () =>
    screen.getByRole("button", { name: "Reset history" }) as HTMLButtonElement;

  it("offers the row only when the page passes resetHistory", () => {
    openWith(reset);
    expect(screen.getByRole("button", { name: /Reset history/ })).toBeTruthy();

    cleanup();
    openWith(undefined);
    expect(screen.queryByText(/Reset history/)).toBeNull();

    cleanup();
    openWith(null);
    expect(screen.queryByText(/Reset history/)).toBeNull();
  });

  it("is the last row, after Start over, in the danger colour with its own separator", () => {
    openWith(reset, { startOver: true });

    const start = screen.getByRole("button", { name: /Start over/ });
    const row = screen.getByRole("button", { name: /Reset history/ });

    expect(row.parentElement).toBe(start.parentElement);
    expect(row.previousElementSibling!.tagName).toBe("HR");
    expect(row.previousElementSibling!.previousElementSibling).toBe(start);
    expect(row.nextElementSibling).toBeNull();
    expect(row.className).toContain("text-danger");
    expect(start.className).not.toContain("text-danger");
    const svg = row.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("fill")).toBe("none");
  });

  it("shows even without Start over, for an untracked show", () => {
    openWith(reset, { status: null });
    expect(screen.getByRole("button", { name: /Reset history/ })).toBeTruthy();
  });

  it("confirms with episodes, ratings and past runs", () => {
    openConfirm();

    expect(screen.getByText("Reset history?")).toBeTruthy();
    expect(
      screen.getByText(
        "This permanently deletes your 7 watched episodes, their ratings and 2 past runs for this show. This can't be undone.",
      ),
    ).toBeTruthy();
  });

  it("uses the singular for one episode and one run", () => {
    openConfirm({ watched: 1, pastRuns: 1 });

    expect(
      screen.getByText(
        "This permanently deletes your 1 watched episode, their ratings and 1 past run for this show. This can't be undone.",
      ),
    ).toBeTruthy();
  });

  it("leaves the past-runs clause out when there are none", () => {
    openConfirm({ watched: 3, pastRuns: 0 });

    expect(
      screen.getByText(
        "This permanently deletes your 3 watched episodes and their ratings for this show. This can't be undone.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/past run/);
  });

  it("does not claim a count when the past runs are unavailable", () => {
    openConfirm({ watched: 3, pastRuns: null });

    expect(
      screen.getByText(
        "This permanently deletes your 3 watched episodes, their ratings and any past runs for this show. This can't be undone.",
      ),
    ).toBeTruthy();
  });

  it("copes with nothing currently watched", () => {
    openConfirm({ watched: 0, pastRuns: 2 });
    expect(
      screen.getByText(
        "This permanently deletes your 2 past runs (with their ratings) for this show. This can't be undone.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\b0 watched/);
  });

  it("returns to the menu on Cancel and calls nothing", () => {
    openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(resetShowHistory).not.toHaveBeenCalled();
    expect(screen.getByText("Track Severance as")).toBeTruthy();
    expect(screen.queryByText(/permanently deletes/)).toBeNull();
  });

  it("resets once with the show id and closes on success", async () => {
    openConfirm();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(resetShowHistory).toHaveBeenCalledTimes(1);
    expect(resetShowHistory).toHaveBeenCalledWith("101");
    expect(startShowOver).not.toHaveBeenCalled();
  });

  it("disables the confirm and Cancel buttons while pending", async () => {
    let finish!: (value: { ok: true }) => void;
    vi.mocked(resetShowHistory).mockReturnValue(
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

  it("keeps the confirmation and the message after a failure, and clears it on the next attempt", async () => {
    vi.mocked(resetShowHistory).mockResolvedValueOnce({
      ok: false,
      error: "Nothing to reset.",
    });

    openConfirm();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    expect(screen.getByRole("alert").textContent).toBe("Nothing to reset.");
    expect(screen.getByText(/permanently deletes/)).toBeTruthy();

    let finish!: (value: { ok: true }) => void;
    vi.mocked(resetShowHistory).mockReturnValueOnce(
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
    vi.mocked(resetShowHistory).mockResolvedValueOnce({ ok: false });
    openConfirm();
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /something went wrong/i,
      ),
    );
  });

  it("shows the menu, not the confirmation, when the sheet is closed and reopened", async () => {
    vi.mocked(resetShowHistory).mockResolvedValueOnce({
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
      screen.getByRole("button", { name: "Change status for Severance" }),
    );
    expect(screen.getByText("Track Severance as")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/permanently deletes/)).toBeNull();
  });

  it("disables every menu row while a status change is pending", async () => {
    const { pauseShow } = await import("@/app/actions");
    let finish!: (value: { ok: true }) => void;
    vi.mocked(pauseShow).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    openWith(reset, { startOver: true });
    fireEvent.click(screen.getByRole("button", { name: /Paused/ }));

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Reset history/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
    expect(
      (screen.getByRole("button", { name: /Start over/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    finish({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("disables the confirm button during the request and leaves the rows live after Cancel", async () => {
    let finish!: (value: { ok: false; error: string }) => void;
    vi.mocked(resetShowHistory).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    openWith(reset, { startOver: true });
    fireEvent.click(screen.getByRole("button", { name: /Reset history/ }));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmButton().disabled).toBe(true));

    finish({ ok: false, error: "Nope." });
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Back on the menu, rows are live again.
    expect(
      (screen.getByRole("button", { name: /Start over/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("keeps the two confirmations apart", async () => {
    vi.mocked(startShowOver).mockResolvedValueOnce({
      ok: false,
      error: "Start over failed.",
    });
    openWith(reset, { startOver: true });

    // Start over's confirmation shows its own text and button only.
    fireEvent.click(screen.getByRole("button", { name: /Start over/ }));
    expect(screen.getByText(/is kept as Run 2/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset history" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Start over failed."),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Start over" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );

    // Cancel returns to the menu, and the error does not follow into Reset's.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Reset history/ }));
    expect(screen.getByText(/permanently deletes/)).toBeTruthy();
    expect(screen.queryByText(/is kept as/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(resetShowHistory).toHaveBeenCalledTimes(1);
    expect(startShowOver).toHaveBeenCalledTimes(1);
  });
});
