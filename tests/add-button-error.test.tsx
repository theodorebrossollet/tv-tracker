// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/action-result";

const addToWatchlist = vi.fn<(id: string) => Promise<ActionResult>>();

vi.mock("@/app/actions", () => ({
  addToWatchlist: (id: string) => addToWatchlist(id),
  removeShow: vi.fn(async () => ({ ok: true })),
}));

const { AddButton } = await import("@/components/add-button");

afterEach(() => {
  cleanup();
  addToWatchlist.mockReset();
});

describe("AddButton errors", () => {
  it("keeps the error visible after the action settles, and clears it on retry", async () => {
    addToWatchlist.mockResolvedValueOnce({ ok: false, error: "Nope." });
    render(<AddButton showId="1" status={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Add to watchlist" }));
    await waitFor(() => expect(addToWatchlist).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Nope.")).toBeTruthy());
    // Still there once the transition has fully settled.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("Nope.")).toBeTruthy();

    addToWatchlist.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Add to watchlist" }));
    await waitFor(() => expect(screen.queryByText("Nope.")).toBeNull());
  });
});
