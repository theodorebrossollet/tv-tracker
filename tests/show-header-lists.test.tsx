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

afterEach(cleanup);

describe("ShowHeader", () => {
  it("renders Add to list beside the status pill, with no lists", () => {
    render(
      <ShowHeader
        showId="1399"
        name="Severance"
        posterPath={null}
        metaLine={null}
        watchedCount={0}
        airedCount={0}
        status={null}
        finished={false}
        nextAiring={null}
        lists={[]}
      />,
    );

    expect(screen.getByRole("button", { name: "Add to list" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Change status for Severance" }),
    ).toBeTruthy();
  });

  it.each([["null", null], ["absent", undefined]])(
    "renders no Add to list button when lists are %s",
    (_name, lists) => {
      render(
        <ShowHeader
          showId="1399"
          name="Severance"
          posterPath={null}
          metaLine={null}
          watchedCount={0}
          airedCount={0}
          status={null}
          finished={false}
          nextAiring={null}
          lists={lists}
        />,
      );

      expect(screen.queryByRole("button", { name: "Add to list" })).toBeNull();
      expect(
        screen.getByRole("button", { name: "Change status for Severance" }),
      ).toBeTruthy();
    },
  );
});
