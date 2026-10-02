// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({}));
vi.mock("@/app/rewatch-actions", () => ({
  startShowOver: vi.fn(),
  resetShowHistory: vi.fn(),
}));
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

afterEach(cleanup);

function header(runNumber?: number | null) {
  return (
    <ShowHeader
      showId="1399"
      name="Severance"
      posterPath={null}
      metaLine={null}
      watchedCount={3}
      airedCount={6}
      status="watching"
      finished={false}
      nextAiring={null}
      runNumber={runNumber}
    />
  );
}

describe("ShowHeader run label", () => {
  it("shows Run 2 for a second run", () => {
    render(header(2));
    expect(screen.getByText("Run 2")).toBeTruthy();
  });

  it.each([
    ["1", 1],
    ["null", null],
    ["absent", undefined],
  ])("shows nothing when the run is %s", (_label, value) => {
    render(header(value));
    expect(screen.queryByText(/^Run \d/)).toBeNull();
  });

  describe("start over pass-through", () => {
    function withStartOver(startOver?: {
      watched: number;
      aired: number;
      runNumber: number | null;
    }) {
      render(
        <ShowHeader
          showId="1399"
          name="Severance"
          posterPath={null}
          metaLine={null}
          watchedCount={3}
          airedCount={6}
          status="watching"
          finished={false}
          nextAiring={null}
          startOver={startOver}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Change status for Severance" }),
      );
    }

    it("offers Start over in the opened pill when startOver is passed", () => {
      withStartOver({ watched: 3, aired: 6, runNumber: 1 });
      expect(screen.getByRole("button", { name: /Start over/ })).toBeTruthy();
    });

    it("offers no Start over in the opened pill without startOver", () => {
      withStartOver(undefined);
      expect(screen.getByText("Track Severance as")).toBeTruthy();
      expect(screen.queryByText(/Start over/)).toBeNull();
    });
  });

  describe("reset history pass-through", () => {
    function withReset(resetHistory?: { watched: number; pastRuns: number | null }) {
      render(
        <ShowHeader
          showId="1399"
          name="Severance"
          posterPath={null}
          metaLine={null}
          watchedCount={3}
          airedCount={6}
          status="watching"
          finished={false}
          nextAiring={null}
          resetHistory={resetHistory}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Change status for Severance" }),
      );
    }

    it("offers Reset history in the opened pill when resetHistory is passed", () => {
      withReset({ watched: 3, pastRuns: 1 });
      expect(screen.getByRole("button", { name: /Reset history/ })).toBeTruthy();
    });

    it("offers none without resetHistory", () => {
      withReset(undefined);
      expect(screen.getByText("Track Severance as")).toBeTruthy();
      expect(screen.queryByText(/Reset history/)).toBeNull();
    });
  });
});
