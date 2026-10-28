// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

function header(backdropPath: string | null) {
  return render(
    <ShowHeader
      showId="95396"
      name="Severance"
      posterPath="/poster.jpg"
      backdropPath={backdropPath}
      metaLine={null}
      watchedCount={13}
      airedCount={19}
      status="watching"
      finished={false}
      nextAiring={null}
    />,
  );
}

/** next/image percent-encodes the source into its own URL. */
function sources(container: HTMLElement): string[] {
  return [...container.querySelectorAll("img")].map((img) =>
    decodeURIComponent(img.getAttribute("src") ?? ""),
  );
}

describe("ShowHeader artwork", () => {
  it("runs the backdrop full-bleed and leaves the poster out", () => {
    const { container } = header("/wide.jpg");

    expect(sources(container).some((src) => src.includes("/w1280/wide.jpg"))).toBe(true);
    expect(screen.queryByRole("img", { name: "Poster for Severance" })).toBeNull();
  });

  it("falls back to the blurred poster, with the poster beside the title, when there is no backdrop", () => {
    const { container } = header(null);

    expect(sources(container).some((src) => src.includes("/w500/poster.jpg"))).toBe(true);
    expect(screen.getByRole("img", { name: "Poster for Severance" })).toBeTruthy();
  });

  it("keeps the title a level-one heading either way", () => {
    header("/wide.jpg");
    expect(screen.getByRole("heading", { level: 1, name: "Severance" })).toBeTruthy();
  });
});
