// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/action-result";

const markEpisodeWatched = vi.fn<(id: string) => Promise<ActionResult>>();
const unmarkEpisodeWatched = vi.fn<(id: string) => Promise<ActionResult>>();

vi.mock("@/app/actions", () => ({
  markEpisodeWatched: (id: string) => markEpisodeWatched(id),
  unmarkEpisodeWatched: (id: string) => unmarkEpisodeWatched(id),
}));

const { toast } = await import("sonner");
const { attempt, notifyUndoable } = await import("@/lib/notify");
const { Toaster } = await import("@/components/toaster");
const { MarkWatchedButton } = await import("@/components/mark-watched-button");

afterEach(() => {
  toast.dismiss();
  cleanup();
  markEpisodeWatched.mockReset();
  unmarkEpisodeWatched.mockReset();
});

describe("attempt", () => {
  it("says nothing when the action worked", async () => {
    render(<Toaster />);

    expect(await attempt(async () => ({ ok: true }))).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("shows the action's own error", async () => {
    render(<Toaster />);

    expect(
      await attempt(async () => ({ ok: false, error: "That episode hasn't aired." })),
    ).toBe(false);
    await waitFor(() =>
      expect(screen.getByText("That episode hasn't aired.")).toBeTruthy(),
    );
  });

  it("catches a call that never reached the server", async () => {
    render(<Toaster />);

    const ok = await attempt(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(ok).toBe(false);
    await waitFor(() => expect(screen.getByText(/Check your connection/)).toBeTruthy());
  });

  it("lets a redirect through instead of reporting it", async () => {
    render(<Toaster />);

    // The shape Next gives an action's `redirect` on the client.
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });

    await expect(
      attempt(async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("does not stack the same failure", async () => {
    render(<Toaster />);

    for (let i = 0; i < 3; i++) {
      await attempt(async () => ({ ok: false, error: "Nope." }));
    }

    await waitFor(() => expect(screen.getAllByText("Nope.")).toHaveLength(1));
  });
});

describe("notifyUndoable", () => {
  it("runs the undo from the toast, and reports an undo that fails", async () => {
    render(<Toaster />);
    unmarkEpisodeWatched.mockResolvedValueOnce({ ok: false, error: "Undo failed." });

    notifyUndoable("Marked watched", () => unmarkEpisodeWatched("e1"));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(unmarkEpisodeWatched).toHaveBeenCalledWith("e1"));
    await waitFor(() => expect(screen.getByText("Undo failed.")).toBeTruthy());
  });
});

describe("MarkWatchedButton", () => {
  it("reports a failed save, which it used to drop", async () => {
    markEpisodeWatched.mockResolvedValueOnce({ ok: false, error: "Could not save." });
    render(
      <>
        <MarkWatchedButton episodeId="e1" showName="Severance" code="S02E07" />
        <Toaster />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark Severance S02E07 watched" }));

    await waitFor(() => expect(screen.getByText("Could not save.")).toBeTruthy());
  });
});
