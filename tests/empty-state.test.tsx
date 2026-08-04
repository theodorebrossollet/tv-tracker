// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmptyState } from "@/components/empty-state";

afterEach(cleanup);

describe("what an empty state tells a screen reader", () => {
  it("reads as its title and description, not its decoration", () => {
    // The glyph restates the title — a bookmark over "Watchlist is empty" adds
    // nothing when read aloud, and an unlabelled graphic is worse than none.
    const { container } = render(
      <EmptyState
        title="Watchlist is empty"
        description="Add shows here when you want to remember to start them later."
        icon="bookmark"
      />,
    );

    expect(screen.getByText("Watchlist is empty")).toBeTruthy();

    const graphics = container.querySelectorAll("svg, [aria-hidden='true']");
    expect(graphics.length).toBeGreaterThan(0);
    for (const graphic of graphics) {
      expect(graphic.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("which states get a button", () => {
  it("renders the action it is given", () => {
    render(
      <EmptyState
        title="Nothing in progress"
        description="Shows land here on their own."
        icon="shows"
        action={<button type="button">Find a show</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Find a show" })).toBeTruthy();
  });

  it("renders no button when there is nothing to do about it", () => {
    // An empty Archive isn't a problem to solve, so it gets no call to action
    // — the absence is the design, not an oversight.
    render(
      <EmptyState
        title="Nothing archived yet"
        description="Shows land here when you finish them."
        icon="archive"
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the inline variant", () => {
  it("suppresses the glyph even when given one", () => {
    // Used for Upcoming, which sits under a populated list: a filled panel
    // with a 34px graphic there reads as the more important of the two.
    //
    // The icon is passed deliberately. Asserting "no glyph" on a call that
    // never supplied one would pass whether or not the variant does anything,
    // which is how a test like this rots into decoration.
    const { container } = render(
      <EmptyState
        title="Nothing scheduled"
        description="None of your tracked shows have an announced air date coming up."
        icon="shows"
        variant="inline"
      />,
    );

    expect(screen.getByText("Nothing scheduled")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(0);
  });
});
