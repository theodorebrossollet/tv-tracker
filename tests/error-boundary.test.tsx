// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorBoundary from "@/app/error";
import { SCHEMA_MISMATCH_DIGEST } from "@/lib/schema-error";

afterEach(cleanup);

/**
 * The boundary has to tell a late migration apart from everything else. It
 * cannot inspect the message — Next scrubs that in production builds, which is
 * the whole reason `lib/prisma.ts` stamps a digest instead.
 */
function renderWith(digest?: string) {
  vi.spyOn(console, "error").mockImplementation(() => {});

  const error = Object.assign(new Error("scrubbed in production"), { digest });
  render(<ErrorBoundary error={error} reset={() => {}} />);

  vi.restoreAllMocks();
}

describe("the page error boundary", () => {
  it("says the app is updating when the schema is behind", () => {
    renderWith(SCHEMA_MISMATCH_DIGEST);

    expect(screen.getByText("The app is being updated")).toBeTruthy();
    expect(screen.queryByText(/TMDB being unreachable/)).toBeNull();
  });

  it("blames TMDB for anything else", () => {
    // A generated digest, which is what every other server error carries — it
    // must not be mistaken for the schema case.
    renderWith("617295349");

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText(/TMDB being unreachable/)).toBeTruthy();
  });

  it("still renders without a digest at all", () => {
    renderWith(undefined);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });
});
