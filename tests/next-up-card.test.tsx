// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ markEpisodeWatched: vi.fn() }));

const { CaughtUpCard, NextUpCard } = await import(
  "@/components/next-up-card"
);

afterEach(cleanup);

function episode(episodeNumber: number, name: string) {
  return {
    id: `e${episodeNumber}`,
    seasonNumber: 2,
    episodeNumber,
    name,
    meta: "Season 2 · 49m · 28 Feb 2025",
  };
}

describe("skipping through the queue", () => {
  it("moves to the next unwatched episode without marking anything", () => {
    render(
      <NextUpCard queue={[episode(7, "Chikhai Bardo"), episode(8, "Sweet Vitriol")]} />,
    );

    expect(screen.getByText("Chikhai Bardo")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Skip S02E07" }));

    expect(screen.getByText("Sweet Vitriol")).toBeTruthy();
    expect(screen.queryByText("Chikhai Bardo")).toBeNull();
  });

  it("wraps back to the start once everything has been skipped", () => {
    // The handoff's rule: when everything left has been skipped, the rotation
    // restarts. Running off the end would leave the card empty, which reads as
    // the show having no episodes rather than as the end of a rotation.
    render(
      <NextUpCard queue={[episode(7, "Chikhai Bardo"), episode(8, "Sweet Vitriol")]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip S02E07" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip S02E08" }));

    expect(screen.getByText("Chikhai Bardo")).toBeTruthy();
  });

  it("survives the server sending a shorter queue than you skipped into", () => {
    // Marking elsewhere — another device, or the season's "Mark all" — shrinks
    // the queue on the next render while the skip position stays where it was.
    // Without the wrap at read time that position is past the end, and the card
    // renders nothing at all.
    const { rerender } = render(
      <NextUpCard
        queue={[episode(7, "Chikhai Bardo"), episode(8, "Sweet Vitriol")]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip S02E07" }));
    expect(screen.getByText("Sweet Vitriol")).toBeTruthy();

    rerender(<NextUpCard queue={[episode(9, "Cold Harbor")]} />);

    expect(screen.getByText("Cold Harbor")).toBeTruthy();
  });

  it("offers no Skip when there is nothing to skip to", () => {
    // A single-episode queue would otherwise have a button that redraws the
    // card exactly as it was.
    render(<NextUpCard queue={[episode(7, "Chikhai Bardo")]} />);

    expect(screen.queryByRole("button", { name: /Skip/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Mark watched/ })).toBeTruthy();
  });
});

describe("the caught-up card", () => {
  it("shows what is next and how far off it is", () => {
    render(
      <CaughtUpCard
        next={{ code: "S03E01", name: "Cold Harbor", date: "21 Sep 2026" }}
        countdown="In 2 months"
      />,
    );

    expect(screen.getByText("Cold Harbor")).toBeTruthy();
    expect(screen.getByText("In 2 months")).toBeTruthy();
  });

  it("says nothing is scheduled when no date is announced", () => {
    // TMDB leaves the date empty for episodes that are announced but
    // unscheduled, and a countdown to nothing would be a lie.
    render(<CaughtUpCard next={null} countdown={null} />);

    expect(screen.getByText("Nothing scheduled")).toBeTruthy();
    expect(screen.getByText("No air date announced")).toBeTruthy();
  });

  it("never offers Mark watched, having nothing to act on", () => {
    // A different card rather than a disabled version of the Next-up one: a
    // greyed-out button invites the tap it will refuse.
    render(
      <CaughtUpCard
        next={{ code: "S03E01", name: "Cold Harbor", date: "21 Sep 2026" }}
        countdown="In 2 months"
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });
});
