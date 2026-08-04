// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshShow = vi.fn();

vi.mock("@/app/actions", () => ({
  refreshShow: (showId: string) => refreshShow(showId),
}));

const { RefreshStrip } = await import("@/components/refresh-strip");

beforeEach(() => {
  refreshShow.mockReset();
  refreshShow.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

function open() {
  return render(
    <RefreshStrip showId="1399" refreshedLabel="Refreshed 3 Aug 2026" />,
  );
}

describe("the refresh strip", () => {
  it("reports when the data was last synced", () => {
    open();

    expect(screen.getByText("Refreshed 3 Aug 2026")).toBeTruthy();
  });

  it("says so once a refresh lands", async () => {
    open();

    fireEvent.click(screen.getByRole("button"));

    expect(await screen.findByText("Updated just now")).toBeTruthy();
    expect(refreshShow).toHaveBeenCalledWith("1399");
  });

  it("surfaces a failure instead of claiming success", async () => {
    // The action decides success by whether `lastSynced` moved, so a failed
    // sync comes back as `ok: false` rather than as a thrown error. Reporting
    // that as "Updated just now" would be the worst outcome available: the
    // reader stops waiting for an episode that was never fetched.
    refreshShow.mockResolvedValue({
      ok: false,
      error: "Couldn't reach TMDB. Please try again.",
    });
    open();

    fireEvent.click(screen.getByRole("button"));

    expect(await screen.findByText("Couldn't reach TMDB")).toBeTruthy();
    expect(screen.queryByText("Updated just now")).toBeNull();
  });

  it("announces the failure rather than only showing it", async () => {
    // The strip is 10px of mono text at the top of the page; someone who
    // tapped it and looked away needs to be told, not shown.
    refreshShow.mockResolvedValue({ ok: false, error: "nope" });
    open();

    fireEvent.click(screen.getByRole("button"));

    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("cannot be tapped twice while one is in flight", async () => {
    // Two concurrent syncs of one show collide on the episode primary key.
    // The action dedupes, but not sending the second request at all is better
    // than relying on it.
    let release: (value: { ok: boolean }) => void = () => {};
    refreshShow.mockReturnValue(
      new Promise<{ ok: boolean }>((resolve) => {
        release = resolve;
      }),
    );

    open();
    const button = screen.getByRole("button");

    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveProperty("disabled", true));

    fireEvent.click(button);
    expect(refreshShow).toHaveBeenCalledTimes(1);

    release({ ok: true });
  });
});
