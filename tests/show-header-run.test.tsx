// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({}));
vi.mock("@/app/rewatch-actions", () => ({ startShowOver: vi.fn() }));
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

  it("offers Start over from the pill when startOver is passed through", () => {
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
        startOver={{ watched: 3, aired: 6, runNumber: 1 }}
      />,
    );
    expect(screen.queryByText("Start over")).toBeNull(); // sheet closed
  });
});
