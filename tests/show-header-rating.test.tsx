// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({}));
vi.mock("@/app/list-actions", () => ({
  addToList: vi.fn(),
  removeFromList: vi.fn(),
  createList: vi.fn(),
  updateList: vi.fn(),
}));
vi.mock("@/components/status-actions", () => ({ STATUS_ACTIONS: {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { ShowHeader } = await import("@/components/show-header");
const { SeasonRatingLine } = await import("@/components/season-rating-line");

afterEach(cleanup);

function header(rating?: { average: number; coverage: string | null } | null) {
  return (
    <ShowHeader
      showId="1399"
      name="Severance"
      posterPath={null}
      metaLine={null}
      watchedCount={3}
      airedCount={6}
      status={null}
      finished={false}
      nextAiring={null}
      rating={rating}
    />
  );
}

describe("ShowHeader rating", () => {
  it("shows the average with one decimal and the coverage text", () => {
    render(header({ average: 7.4, coverage: "2 of 3 watched episodes rated" }));

    expect(
      screen.getByRole("img", { name: "Average rating 7.4 out of 10" }),
    ).toBeTruthy();
    expect(screen.getByText("2 of 3 watched episodes rated")).toBeTruthy();
  });

  it("omits the coverage line when coverage is null", () => {
    render(header({ average: 8, coverage: null }));

    expect(
      screen.getByRole("img", { name: /Average rating 8.0/ }),
    ).toBeTruthy();
    expect(screen.queryByText(/rated/)).toBeNull();
  });

  it.each([
    ["null", null],
    ["absent", undefined],
  ])("renders neither when rating is %s, header intact", (_n, rating) => {
    render(header(rating));

    expect(screen.queryByRole("img", { name: /Average/ })).toBeNull();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Severance" })).toBeTruthy();
  });
});

describe("SeasonRatingLine", () => {
  it("shows the average and coverage when partially rated", () => {
    render(<SeasonRatingLine average={7.5} rated={2} watched={4} />);

    expect(
      screen.getByRole("img", { name: /Average rating 7.5/ }),
    ).toBeTruthy();
    expect(screen.getByText("2 of 4 rated")).toBeTruthy();
  });

  it("omits coverage when every watched episode is rated", () => {
    render(<SeasonRatingLine average={9} rated={4} watched={4} />);

    expect(
      screen.getByRole("img", { name: /Average rating 9.0/ }),
    ).toBeTruthy();
    expect(screen.queryByText(/rated$/)).toBeNull();
  });

  it("renders nothing when the season has no rating", () => {
    const { container } = render(
      <SeasonRatingLine average={null} rated={0} watched={4} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("never prints NaN or undefined", () => {
    const { container } = render(
      <SeasonRatingLine average={7} rated={1} watched={3} />,
    );

    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });
});
