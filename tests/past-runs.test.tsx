// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PastRuns } from "@/components/past-runs";
import type { PastRun } from "@/lib/queries";
import { formatWatchedDate } from "@/lib/format";

afterEach(cleanup);

const d = (iso: string) => new Date(iso);
const fmt = (date: Date) => formatWatchedDate(date.toISOString());

function run(over: Partial<PastRun> = {}): PastRun {
  return {
    runNumber: 1,
    archivedAt: d("2026-02-10T12:00:00Z"),
    firstWatchedAt: d("2026-01-05T17:00:00Z"),
    lastWatchedAt: d("2026-02-09T17:00:00Z"),
    episodeCount: 20,
    ratingAverage: null,
    ...over,
  };
}

describe("PastRuns", () => {
  it("renders nothing for null and for an empty list", () => {
    const a = render(<PastRuns runs={null} />);
    expect(a.container.innerHTML).toBe("");
    a.unmount();
    const b = render(<PastRuns runs={[]} />);
    expect(b.container.innerHTML).toBe("");
    expect(screen.queryByText("Past runs")).toBeNull();
  });

  it("renders a literal line for a mid-day instant", () => {
    render(<PastRuns runs={[run({ runNumber: 2 })]} />);
    expect(screen.getByText("Past runs")).toBeTruthy();
    expect(
      screen.getByText("Run 2 · 5 Jan 2026 – 9 Feb 2026 · 20 episodes"),
    ).toBeTruthy();
  });

  it("lists runs in the incoming order, rating only where present", () => {
    const first = run({ runNumber: 2, ratingAverage: 8.1 });
    const second = run({
      runNumber: 1,
      firstWatchedAt: d("2025-03-01T17:00:00Z"),
      lastWatchedAt: d("2025-04-02T17:00:00Z"),
      episodeCount: 10,
    });
    render(<PastRuns runs={[first, second]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain(
      `Run 2 · ${fmt(first.firstWatchedAt!)} – ${fmt(first.lastWatchedAt!)} · 20 episodes`,
    );
    expect(items[0].textContent).toContain("★ 8.1");
    expect(items[1].textContent).toContain("Run 1 ·");
    expect(items[1].textContent).toContain("10 episodes");
    expect(items[1].textContent).not.toContain("★");
  });

  it("uses the singular for one episode", () => {
    render(<PastRuns runs={[run({ episodeCount: 1 })]} />);
    expect(screen.getByText(/· 1 episode$/)).toBeTruthy();
  });

  it("shows one date when first and last are the same day", () => {
    const at = d("2026-01-05T17:00:00Z");
    render(
      <PastRuns
        runs={[
          run({
            firstWatchedAt: at,
            lastWatchedAt: d("2026-01-05T18:30:00Z"),
          }),
        ]}
      />,
    );
    expect(screen.getByText(`Run 1 · ${fmt(at)} · 20 episodes`)).toBeTruthy();
  });

  it("leaves out null dates without stray separators", () => {
    const at = d("2026-01-05T17:00:00Z");
    render(
      <PastRuns
        runs={[
          run({ runNumber: 3, firstWatchedAt: null, lastWatchedAt: at }),
          run({ runNumber: 2, firstWatchedAt: at, lastWatchedAt: null }),
          run({ runNumber: 1, firstWatchedAt: null, lastWatchedAt: null }),
        ]}
      />,
    );
    expect(screen.getByText(`Run 3 · ${fmt(at)} · 20 episodes`)).toBeTruthy();
    expect(screen.getByText(`Run 2 · ${fmt(at)} · 20 episodes`)).toBeTruthy();
    expect(screen.getByText("Run 1 · 20 episodes")).toBeTruthy();
  });

  it("shows a whole-number average with one decimal", () => {
    render(<PastRuns runs={[run({ ratingAverage: 8 })]} />);
    expect(screen.getByText("8.0", { exact: false })).toBeTruthy();
    expect(document.body.textContent).toContain("★ 8.0");
  });

  it("never prints NaN, undefined or null, and has no controls", () => {
    render(
      <PastRuns
        runs={[
          run({ firstWatchedAt: null, lastWatchedAt: null }),
          run({ ratingAverage: 8.1 }),
        ]}
      />,
    );
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
