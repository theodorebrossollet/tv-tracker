// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markEpisodeWatched = vi.fn();
const unmarkEpisodeWatched = vi.fn();
const rateEpisode = vi.fn();

vi.mock("@/app/actions", () => ({
  markEpisodeWatched: (id: string) => markEpisodeWatched(id),
  unmarkEpisodeWatched: (id: string) => unmarkEpisodeWatched(id),
}));
vi.mock("@/app/rating-actions", () => ({
  rateMovie: vi.fn(),
  rateEpisode: (id: string, r: number | null) => rateEpisode(id, r),
}));

const { EpisodeRow } = await import("@/components/episode-row");

beforeEach(() => {
  vi.resetAllMocks();
  markEpisodeWatched.mockResolvedValue({ ok: true });
  unmarkEpisodeWatched.mockResolvedValue({ ok: true });
  rateEpisode.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function row(watched: boolean, rating: number | null) {
  return (
    <ul>
      <EpisodeRow
        episodeId="ep-1"
        seasonNumber={1}
        episodeNumber={2}
        name="Half Loop"
        airDate="2024-01-01T00:00:00.000Z"
        watched={watched}
        aired
        runtime={50}
        overview="Something happens."
        rating={rating}
      />
    </ul>
  );
}

describe("EpisodeRow ratings", () => {
  it("shows no rating UI for an unwatched episode", () => {
    render(row(false, null));

    expect(screen.queryByRole("button", { name: /^Rate/ })).toBeNull();
    expect(screen.queryByRole("img", { name: /Rated/ })).toBeNull();
  });

  it("shows no rating UI for an unwatched episode even with a stored rating", () => {
    render(row(false, 8));

    expect(screen.queryByRole("img", { name: /Rated/ })).toBeNull();
  });

  it("offers Rate on a watched unrated episode and opens the strip", () => {
    render(row(true, null));

    expect(screen.queryByRole("group", { name: "Your rating" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rate S01E02" }));

    expect(screen.getByRole("group", { name: "Your rating" })).toBeTruthy();
  });

  it("shows the chip for a rated episode and opens the strip from it", () => {
    render(row(true, 8));

    const chip = screen.getByRole("button", {
      name: "Change rating for S01E02, rated 8",
    });
    expect(chip.textContent).toContain("★ 8");

    fireEvent.click(chip);

    const pressed = screen.getByRole("button", {
      name: "Rate 8 out of 10",
    });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles the strip closed again", () => {
    render(row(true, null));

    fireEvent.click(screen.getByRole("button", { name: "Rate S01E02" }));
    fireEvent.click(screen.getByRole("button", { name: "Rate S01E02" }));

    expect(screen.queryByRole("group", { name: "Your rating" })).toBeNull();
  });

  it("sends rateEpisode with the episode id", async () => {
    render(row(true, null));

    fireEvent.click(screen.getByRole("button", { name: "Rate S01E02" }));
    fireEvent.click(screen.getByRole("button", { name: "Rate 7 out of 10" }));

    await waitFor(() => expect(rateEpisode).toHaveBeenCalledWith("ep-1", 7));
    expect(markEpisodeWatched).not.toHaveBeenCalled();
  });

  it("hides the rating UI as soon as the episode is unmarked", async () => {
    let finish!: () => void;
    unmarkEpisodeWatched.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ ok: true });
      }),
    );
    render(row(true, 8));
    fireEvent.click(screen.getByRole("button", { name: "Change rating for S01E02, rated 8" }));
    expect(screen.getByRole("group", { name: "Your rating" })).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => {
      expect(screen.queryByRole("group", { name: "Your rating" })).toBeNull();
      expect(screen.queryByRole("img", { name: /Rated/ })).toBeNull();
    });
    finish();
  });

  it("marking watched is not blocked by the rating UI", async () => {
    render(row(false, null));

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() =>
      expect(markEpisodeWatched).toHaveBeenCalledWith("ep-1"),
    );
    expect(rateEpisode).not.toHaveBeenCalled();
  });

  it("does not reopen the strip after an un-watch settles back to watched", async () => {
    render(row(true, null));
    fireEvent.click(screen.getByRole("button", { name: "Rate S01E02" }));
    expect(screen.getByRole("group", { name: "Your rating" })).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(unmarkEpisodeWatched).toHaveBeenCalled());

    // The mocked action does not change the prop, so the optimistic value
    // settles back to watched: the strip must not come back with it.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Rate S01E02" })).toBeTruthy(),
    );
    expect(screen.queryByRole("group", { name: "Your rating" })).toBeNull();
  });

  it("closes the strip when the watched prop goes false, and stays closed on re-watch", () => {
    const { rerender } = render(row(true, null));
    fireEvent.click(screen.getByRole("button", { name: "Rate S01E02" }));
    expect(screen.getByRole("group", { name: "Your rating" })).toBeTruthy();

    rerender(row(false, null));
    expect(screen.queryByRole("group", { name: "Your rating" })).toBeNull();

    rerender(row(true, null));
    expect(screen.queryByRole("group", { name: "Your rating" })).toBeNull();
    expect(screen.getByRole("button", { name: "Rate S01E02" })).toBeTruthy();
  });

  it("names each episode's rating button distinctly", () => {
    render(
      <ul>
        <EpisodeRow
          episodeId="ep-1"
          seasonNumber={1}
          episodeNumber={2}
          name="Half Loop"
          airDate="2024-01-01T00:00:00.000Z"
          watched
          aired
          runtime={50}
          overview={null}
          rating={null}
        />
        <EpisodeRow
          episodeId="ep-2"
          seasonNumber={1}
          episodeNumber={3}
          name="Full Loop"
          airDate="2024-01-08T00:00:00.000Z"
          watched
          aired
          runtime={50}
          overview={null}
          rating={9}
        />
      </ul>,
    );

    expect(screen.getByRole("button", { name: "Rate S01E02" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Change rating for S01E03, rated 9" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rate" })).toBeNull();
  });

  it("gives the rating button a comfortable tap target", () => {
    render(row(true, null));

    const button = screen.getByRole("button", { name: "Rate S01E02" });
    expect(button.className).toContain("min-h-10");
    expect(button.className).toContain("min-w-10");
  });

  it("shows no Rate button after an optimistic mark until the server confirms", async () => {
    let finish!: () => void;
    markEpisodeWatched.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ ok: true });
      }),
    );
    const { rerender } = render(row(false, null));

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(markEpisodeWatched).toHaveBeenCalled());
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.queryByRole("button", { name: /^Rate S01E02/ })).toBeNull();

    rerender(row(true, null));
    expect(screen.getByRole("button", { name: "Rate S01E02" })).toBeTruthy();
    finish();
  });

  it("hides the Rate button immediately on an optimistic un-watch", async () => {
    let finish!: () => void;
    unmarkEpisodeWatched.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ ok: true });
      }),
    );
    render(row(true, null));
    expect(screen.getByRole("button", { name: "Rate S01E02" })).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /^Rate S01E02|^Change rating/ }),
      ).toBeNull(),
    );
    finish();
  });
});
