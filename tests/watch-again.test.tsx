// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/action-result";
import { formatWatchedDate } from "@/lib/format";

const watchMovieAgain = vi.fn<(id: string) => Promise<ActionResult>>();

vi.mock("@/app/rewatch-actions", () => ({
  watchMovieAgain: (id: string) => watchMovieAgain(id),
  startShowOver: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
}

const { WatchAgainButton } = await import("@/components/watch-again-button");
const { PastWatches } = await import("@/components/past-watches");

const WATCHED = "2026-03-03T17:00:00.000Z";
const DATE = formatWatchedDate(WATCHED);

beforeEach(() => {
  vi.clearAllMocks();
  watchMovieAgain.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function open(
  props: { watchedAt?: string | null; rating?: number | null } = {},
) {
  render(
    <WatchAgainButton
      movieId="603"
      watchedAt={props.watchedAt === undefined ? WATCHED : props.watchedAt}
      rating={props.rating === undefined ? 8 : props.rating}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Watch again" }));
}

function dialogText() {
  const dialog = screen.getByRole("dialog", { hidden: true });
  return Array.from(dialog.querySelectorAll("p"))
    .map((p) => p.textContent)
    .join(" ");
}

const confirm = () =>
  within(screen.getByRole("dialog", { hidden: true })).getByRole("button", {
    name: "Watch again",
    hidden: true,
  });

describe("WatchAgainButton", () => {
  it("shows no sheet until opened", () => {
    render(<WatchAgainButton movieId="603" watchedAt={WATCHED} rating={8} />);
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("explains what is kept, with date and rating", () => {
    open();
    expect(dialogText()).toContain(
      `Log a new watch? Your ${DATE} watch and its rating (8) are kept in Past watches. The movie shows as watched today with no rating.`,
    );
  });

  it("leaves out the rating clause when unrated", () => {
    open({ rating: null });
    const text = dialogText();
    expect(text).toContain(
      `Log a new watch? Your ${DATE} watch is kept in Past watches. The movie shows as watched today with no rating.`,
    );
    expect(text).not.toMatch(/its rating|NaN|undefined|null/);
  });

  it("leaves out the date clause when the date is null", () => {
    open({ watchedAt: null });
    expect(dialogText()).toContain(
      "Log a new watch? Your watch and its rating (8) are kept in Past watches.",
    );
  });

  it("copes with neither date nor rating", () => {
    open({ watchedAt: null, rating: null });
    const text = dialogText();
    expect(text).toContain(
      "Log a new watch? Your watch is kept in Past watches. The movie shows as watched today with no rating.",
    );
    expect(text).not.toMatch(/NaN|undefined|null/);
  });

  it("Cancel closes and calls nothing", () => {
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel", hidden: true }),
    );
    expect(watchMovieAgain).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("confirming calls the action once with the id and closes on success", async () => {
    open();
    fireEvent.click(confirm());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { hidden: true })).toBeNull(),
    );
    expect(watchMovieAgain).toHaveBeenCalledTimes(1);
    expect(watchMovieAgain).toHaveBeenCalledWith("603");
  });

  it("is disabled while pending", async () => {
    let release!: (r: ActionResult) => void;
    watchMovieAgain.mockReturnValue(new Promise((r) => (release = r)));
    open();
    fireEvent.click(confirm());
    await waitFor(() =>
      expect((confirm() as HTMLButtonElement).disabled).toBe(true),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Cancel",
          hidden: true,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    release({ ok: true });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { hidden: true })).toBeNull(),
    );
  });

  it("keeps the sheet and shows the message after a failure settles", async () => {
    watchMovieAgain.mockResolvedValue({
      ok: false,
      error: "Mark it watched first.",
    });
    open();
    fireEvent.click(confirm());
    await waitFor(() =>
      expect((confirm() as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByRole("alert", { hidden: true }).textContent).toBe(
      "Mark it watched first.",
    );
    expect(screen.getByRole("dialog", { hidden: true })).toBeTruthy();
  });

  it("clears the message at the start of the next attempt", async () => {
    watchMovieAgain.mockResolvedValueOnce({ ok: false, error: "Boom." });
    let release!: (r: ActionResult) => void;
    open();
    fireEvent.click(confirm());
    await waitFor(() =>
      expect(screen.getByRole("alert", { hidden: true })).toBeTruthy(),
    );
    watchMovieAgain.mockReturnValueOnce(new Promise((r) => (release = r)));
    fireEvent.click(confirm());
    await waitFor(() =>
      expect(screen.queryByRole("alert", { hidden: true })).toBeNull(),
    );
    release({ ok: true });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { hidden: true })).toBeNull(),
    );
  });

  it("clears the message when the sheet is closed and reopened", async () => {
    watchMovieAgain.mockResolvedValue({ ok: false, error: "Boom." });
    open();
    fireEvent.click(confirm());
    await waitFor(() =>
      expect(screen.getByRole("alert", { hidden: true })).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel", hidden: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Watch again" }));
    expect(screen.queryByRole("alert", { hidden: true })).toBeNull();
  });

  it("falls back to a generic message when the failure has none", async () => {
    watchMovieAgain.mockResolvedValue({ ok: false });
    open();
    fireEvent.click(confirm());
    await waitFor(() =>
      expect(screen.getByRole("alert", { hidden: true }).textContent).toMatch(
        /something went wrong/i,
      ),
    );
  });
});

describe("PastWatches", () => {
  const w = (iso: string, rating: number | null) => ({
    watchedAt: new Date(iso),
    rating,
  });

  it("renders nothing for null and for an empty list", () => {
    const a = render(<PastWatches watches={null} />);
    expect(a.container.innerHTML).toBe("");
    a.unmount();
    const b = render(<PastWatches watches={[]} />);
    expect(b.container.innerHTML).toBe("");
  });

  it("lists watches in the incoming order, rating only where present", () => {
    const newer = w("2026-03-03T17:00:00Z", 8);
    const older = w("2025-01-02T17:00:00Z", null);
    render(<PastWatches watches={[newer, older]} />);
    expect(screen.getByText("Past watches")).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe(
      `${formatWatchedDate(newer.watchedAt.toISOString())} · ★ 8`,
    );
    expect(items[1].textContent).toBe(
      formatWatchedDate(older.watchedAt.toISOString()),
    );
  });

  it("never prints NaN, undefined or null, and has no controls", () => {
    render(
      <PastWatches
        watches={[
          w("2026-03-03T17:00:00Z", 8),
          w("2025-01-02T17:00:00Z", null),
        ]}
      />,
    );
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
