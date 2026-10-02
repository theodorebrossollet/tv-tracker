// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/action-result";

const rateMovie =
  vi.fn<(id: string, r: number | null) => Promise<ActionResult>>();
const rateEpisode =
  vi.fn<(id: string, r: number | null) => Promise<ActionResult>>();

vi.mock("@/app/rating-actions", () => ({
  rateMovie: (id: string, r: number | null) => rateMovie(id, r),
  rateEpisode: (id: string, r: number | null) => rateEpisode(id, r),
}));

const { RatingStrip } = await import("@/components/rating-strip");
const { RatingValue } = await import("@/components/rating-value");

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const step = (n: number) =>
  screen.getByRole("button", {
    name: `Rate ${n} out of 10`,
  }) as HTMLButtonElement;
const pressed = () =>
  screen
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.getAttribute("aria-label"));
const allEnabled = () =>
  screen
    .getAllByRole("button")
    .every((b) => !(b as HTMLButtonElement).disabled);

describe("RatingStrip", () => {
  it("renders a named group of ten steps with the chosen one pressed", () => {
    render(<RatingStrip kind="movie" id="603" rating={7} />);

    expect(screen.getByRole("group", { name: "Your rating" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(10);
    for (let n = 1; n <= 10; n++) expect(step(n)).toBeTruthy();
    expect(pressed()).toEqual(["Rate 7 out of 10"]);
  });

  it("presses nothing when unrated", () => {
    render(<RatingStrip kind="movie" id="603" rating={null} />);
    expect(pressed()).toEqual([]);
  });

  it("sends a movie rating to rateMovie", async () => {
    rateMovie.mockResolvedValue({ ok: true });
    render(<RatingStrip kind="movie" id="603" rating={null} />);

    fireEvent.click(step(8));

    expect(rateMovie).toHaveBeenCalledWith("603", 8);
    expect(rateEpisode).not.toHaveBeenCalled();
    await waitFor(() => expect(allEnabled()).toBe(true));
  });

  it("sends an episode rating to rateEpisode", async () => {
    rateEpisode.mockResolvedValue({ ok: true });
    render(<RatingStrip kind="episode" id="ep-1" rating={3} />);

    fireEvent.click(step(9));

    expect(rateEpisode).toHaveBeenCalledWith("ep-1", 9);
    expect(rateMovie).not.toHaveBeenCalled();
    await waitFor(() => expect(allEnabled()).toBe(true));
  });

  it("tapping the pressed step sends null", async () => {
    rateMovie.mockResolvedValue({ ok: true });
    render(<RatingStrip kind="movie" id="603" rating={7} />);

    fireEvent.click(step(7));

    expect(rateMovie).toHaveBeenCalledWith("603", null);
    await waitFor(() => expect(allEnabled()).toBe(true));
  });

  it("shows the new step optimistically while pending, and disables the buttons", async () => {
    const gate = deferred<ActionResult>();
    rateMovie.mockReturnValue(gate.promise);
    render(<RatingStrip kind="movie" id="603" rating={2} />);

    fireEvent.click(step(8));

    await waitFor(() => expect(step(8).disabled).toBe(true));
    expect(
      screen
        .getAllByRole("button")
        .every((b) => (b as HTMLButtonElement).disabled),
    ).toBe(true);
    expect(pressed()).toEqual(["Rate 8 out of 10"]);

    gate.resolve({ ok: true });
    await waitFor(() => expect(allEnabled()).toBe(true));
  });

  it("rapid taps: the later value is sent last and the strip ends consistent", async () => {
    const first = deferred<ActionResult>();
    rateMovie.mockReturnValueOnce(first.promise);
    rateMovie.mockResolvedValueOnce({ ok: true });
    render(<RatingStrip kind="movie" id="603" rating={null} />);

    fireEvent.click(step(4));
    await waitFor(() => expect(step(4).disabled).toBe(true));
    // Ignored while pending: the button is disabled.
    fireEvent.click(step(9));
    expect(rateMovie).toHaveBeenCalledTimes(1);

    first.resolve({ ok: true });
    await waitFor(() => expect(allEnabled()).toBe(true));

    fireEvent.click(step(9));
    await waitFor(() => expect(allEnabled()).toBe(true));

    expect(rateMovie.mock.calls.map((c) => c[1])).toEqual([4, 9]);
    // The prop never changed (no server in this test), so the settled strip
    // shows the server value again, with exactly one step or none pressed.
    expect(pressed().length).toBeLessThanOrEqual(1);
  });

  it("keeps a failure message after settling and reverts the pressed step", async () => {
    rateMovie.mockResolvedValue({
      ok: false,
      error: "That change isn't available.",
    });
    render(<RatingStrip kind="movie" id="603" rating={5} />);

    fireEvent.click(step(8));

    await waitFor(() => expect(allEnabled()).toBe(true));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("That change isn't available.");
    expect(pressed()).toEqual(["Rate 5 out of 10"]);
  });

  it("falls back to a generic message", async () => {
    rateMovie.mockResolvedValue({ ok: false });
    render(<RatingStrip kind="movie" id="603" rating={null} />);

    fireEvent.click(step(1));

    await waitFor(() => expect(allEnabled()).toBe(true));
    expect(screen.getByRole("alert").textContent).toBe("Something went wrong.");
  });

  it("clears the message at the start of the next tap", async () => {
    rateMovie.mockResolvedValueOnce({ ok: false, error: "x" });
    const gate = deferred<ActionResult>();
    rateMovie.mockReturnValueOnce(gate.promise);
    render(<RatingStrip kind="movie" id="603" rating={null} />);

    fireEvent.click(step(3));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("x"),
    );
    await waitFor(() => expect(allEnabled()).toBe(true));

    fireEvent.click(step(3));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    gate.resolve({ ok: true });
    await waitFor(() => expect(allEnabled()).toBe(true));
  });
});

describe("RatingValue", () => {
  it("renders a whole rating", () => {
    render(<RatingValue value={8} />);
    expect(screen.getByLabelText("Rated 8 out of 10").textContent).toBe("★ 8");
  });

  it("renders an average with one decimal", () => {
    render(<RatingValue value={7.4} average />);
    expect(
      screen.getByLabelText("Average rating 7.4 out of 10").textContent,
    ).toBe("★ 7.4");
  });

  it("renders a whole-number average as 8.0", () => {
    render(<RatingValue value={8} average />);
    expect(
      screen.getByLabelText("Average rating 8.0 out of 10").textContent,
    ).toBe("★ 8.0");
  });
});
