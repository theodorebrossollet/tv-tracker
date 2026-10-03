// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reset = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/discover-actions", () => ({
  resetDismissedSuggestions: (...args: unknown[]) => reset(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { HiddenSuggestions } = await import("@/app/settings/hidden-suggestions");

beforeEach(() => {
  reset.mockReset();
  refresh.mockReset();
  reset.mockResolvedValue({ ok: true, count: 3 });
});
afterEach(cleanup);

describe("HiddenSuggestions", () => {
  it("reads None with no button when nothing is hidden", () => {
    render(<HiddenSuggestions count={0} />);
    expect(screen.getByText("Hidden suggestions")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads Unavailable with no button when the count could not be read", () => {
    render(<HiddenSuggestions count={null} />);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the count and the button", () => {
    render(<HiddenSuggestions count={3} />);
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show them again" })).toBeTruthy();
  });

  it("calls nothing when cancelled", () => {
    render(<HiddenSuggestions count={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Show them again" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(reset).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Show them again" })).toBeTruthy();
  });

  it("confirms once, refreshes and shows Done", async () => {
    render(<HiddenSuggestions count={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Show them again" }));
    // Opening the confirmation must not act by itself.
    expect(reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show them again" }));
    await waitFor(() => expect(screen.getByText("Done")).toBeTruthy());
    expect(reset).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the error visible after the action settles", async () => {
    reset.mockResolvedValue({ ok: false, error: "Something went wrong." });
    render(<HiddenSuggestions count={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Show them again" }));
    fireEvent.click(screen.getByRole("button", { name: "Show them again" }));
    await waitFor(() => expect(screen.getByText("Something went wrong.")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("Something went wrong.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("Done")).toBeNull();
  });
});
