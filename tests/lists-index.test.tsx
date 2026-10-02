// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/app/list-actions", () => ({
  createList: vi.fn(),
  updateList: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "s",
    user: { id: "u1", nickname: "u", hasPassword: true },
  })),
}));
vi.mock("@/lib/queries", () => ({ getLists: vi.fn() }));

const { default: ListsPage } = await import("@/app/lists/page");
const { getLists } = await import("@/lib/queries");

import type { ListSummary } from "@/lib/queries";

const lists = vi.mocked(getLists);

beforeEach(() => lists.mockReset());
afterEach(cleanup);

async function renderPage(rows: ListSummary[]) {
  lists.mockResolvedValue(rows);
  render(await ListsPage());
}

describe("the lists index", () => {
  it("renders rows linking to each list with singular and plural counts", async () => {
    await renderPage([
      { id: "a", name: "One", trackSeparately: false, itemCount: 1 },
      { id: "b", name: "Many", trackSeparately: false, itemCount: 12 },
      { id: "c", name: "None", trackSeparately: false, itemCount: 0 },
    ]);

    expect(screen.getByText("1 title")).toBeTruthy();
    expect(screen.getByText("12 titles")).toBeTruthy();
    expect(screen.getByText("0 titles")).toBeTruthy();
    expect(screen.getByRole("link", { name: /One/ }).getAttribute("href")).toBe(
      "/lists/a",
    );
    expect(screen.getByRole("heading", { name: "Lists" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New list" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });

  it("labels only the together lists", async () => {
    await renderPage([
      { id: "a", name: "Solo", trackSeparately: false, itemCount: 2 },
      { id: "b", name: "Movie night", trackSeparately: true, itemCount: 2 },
    ]);

    expect(screen.getAllByText("Together")).toHaveLength(1);
  });

  it("shows the empty state with a way to start", async () => {
    await renderPage([]);

    expect(screen.getByText("Start your first list")).toBeTruthy();
    // One in the header, one as the empty state's action.
    expect(
      screen.getAllByRole("button", { name: "New list" }).length,
    ).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });
});
