// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/action-result";

const setViewMode = vi.fn<(mode: string) => Promise<ActionResult>>();
vi.mock("@/app/view-actions", () => ({
  setViewMode: (mode: string) => setViewMode(mode),
}));

const { ViewToggle } = await import("@/components/view-toggle");

beforeEach(() => {
  vi.clearAllMocks();
  setViewMode.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

const pressed = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("ViewToggle", () => {
  it("shows the current view as pressed", () => {
    render(<ViewToggle view="posters" />);
    expect(pressed("Posters view")).toBe("true");
    expect(pressed("Rows view")).toBe("false");
  });

  it("asks for the other view when it is pressed", async () => {
    render(<ViewToggle view="rows" />);
    fireEvent.click(screen.getByRole("button", { name: "Posters view" }));
    await waitFor(() => expect(setViewMode).toHaveBeenCalledWith("posters"));
    expect(setViewMode).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the current view is pressed again", () => {
    render(<ViewToggle view="rows" />);
    fireEvent.click(screen.getByRole("button", { name: "Rows view" }));
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it("keeps a failure on screen after the action settles", async () => {
    setViewMode.mockResolvedValue({ ok: false, error: "Nope." });
    render(<ViewToggle view="rows" />);
    fireEvent.click(screen.getByRole("button", { name: "Posters view" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Nope."));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByRole("alert").textContent).toBe("Nope.");
    // The optimistic press is dropped once the prop wins again.
    expect(pressed("Rows view")).toBe("true");
  });

  it("clears an old failure on the next attempt", async () => {
    setViewMode.mockResolvedValueOnce({ ok: false, error: "Nope." });
    render(<ViewToggle view="rows" />);
    fireEvent.click(screen.getByRole("button", { name: "Posters view" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    // Wait for the optimistic press to be dropped, or the second click lands
    // while "posters" still looks pressed and is (rightly) ignored.
    await waitFor(() => expect(pressed("Rows view")).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Posters view" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
