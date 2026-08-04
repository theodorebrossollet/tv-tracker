// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The sheet's rows map to these; what each one does is covered against a real
// database in status-transitions.test.ts. This file is about what gets drawn.
vi.mock("@/app/actions", () => ({
  addToWatchlist: vi.fn(async () => ({ ok: true })),
  pauseShow: vi.fn(async () => ({ ok: true })),
  removeShow: vi.fn(async () => ({ ok: true })),
  resumeShow: vi.fn(async () => ({ ok: true })),
  stopShow: vi.fn(async () => ({ ok: true })),
}));

const { StatusMenu } = await import("@/components/status-sheet");

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
