// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WatchedDate, WatchedRange } from "@/components/watched-date";
import { formatWatchedDate } from "@/lib/format";

// 02:00 UTC on 2 Oct: still 1 Oct in New York, already 2 Oct in Paris.
const INSTANT = "2026-10-02T02:00:00Z";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function viewerZone(zone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone: zone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

describe("formatWatchedDate zone", () => {
  it("takes the day in the given zone, Eastern by default", () => {
    expect(formatWatchedDate(INSTANT)).toBe("1 Oct 2026");
    expect(formatWatchedDate(INSTANT, "Europe/Paris")).toBe("2 Oct 2026");
  });

  it("falls back to Eastern for an unknown zone", () => {
    expect(formatWatchedDate(INSTANT, "Not/AZone")).toBe("1 Oct 2026");
  });
});

describe("WatchedDate", () => {
  it("renders the app zone on the server", () => {
    viewerZone("Europe/Paris");
    expect(renderToString(<WatchedDate iso={INSTANT} />)).toBe("1 Oct 2026");
  });

  it("uses the viewer's zone in the browser", () => {
    viewerZone("Europe/Paris");
    const { container } = render(<WatchedDate iso={INSTANT} />);
    expect(container.textContent).toBe("2 Oct 2026");
  });

  it("formats a range in the viewer's zone and collapses a single day", () => {
    viewerZone("Europe/Paris");
    const a = render(
      <WatchedRange first="2026-10-02T01:00:00Z" last="2026-10-02T21:00:00Z" />,
    );
    expect(a.container.textContent).toBe("2 Oct 2026");
    a.unmount();
    const b = render(
      <WatchedRange first="2026-01-05T17:00:00Z" last="2026-02-09T17:00:00Z" />,
    );
    expect(b.container.textContent).toBe("5 Jan 2026 – 9 Feb 2026");
  });
});
