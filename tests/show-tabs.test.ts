import { describe, expect, it } from "vitest";

import { seasonFrom, showHref, tabFrom } from "@/lib/show-tabs";

describe("reading the tab off the URL", () => {
  it("takes a known tab as given", () => {
    expect(tabFrom({ tab: "watch" })).toBe("watch");
    expect(tabFrom({ tab: "about" })).toBe("about");
  });

  it("falls back to Episodes for anything else", () => {
    // A hand-edited param is as attacker-supplied as any other input, and the
    // value picks which branch of the page renders. Nothing here should throw
    // or render an empty screen.
    for (const raw of ["", "Watch", "../about", "<script>", undefined]) {
      expect(tabFrom({ tab: raw })).toBe("episodes");
    }
  });

  it("takes the last value when the param is repeated", () => {
    expect(tabFrom({ tab: ["episodes", "watch"] })).toBe("watch");
  });
});

describe("reading the season off the URL", () => {
  const available = [1, 2, 3];

  it("takes a season the show actually has", () => {
    expect(seasonFrom({ season: "2" }, available)).toBe(2);
  });

  it("refuses one it doesn't", () => {
    // Season 9 of a three-season show renders an empty episode list, which
    // reads as a broken page rather than a bad link.
    expect(seasonFrom({ season: "9" }, available)).toBe(1);
    expect(seasonFrom({ season: "-1" }, available)).toBe(1);
    expect(seasonFrom({ season: "abc" }, available)).toBe(1);
    expect(seasonFrom({ season: "2.5" }, available)).toBe(1);
  });

  it("lands on the season you're partway through when none is asked for", () => {
    // Opening a show you're midway into should not start you at season 1.
    expect(seasonFrom({}, available, 3)).toBe(3);
  });

  it("ignores a preference the show doesn't have either", () => {
    expect(seasonFrom({}, available, 7)).toBe(1);
  });

  it("prefers the explicit param over the suggestion", () => {
    expect(seasonFrom({ season: "2" }, available, 3)).toBe(2);
  });

  it("survives a show with no seasons at all", () => {
    expect(seasonFrom({ season: "1" }, [])).toBe(1);
  });
});

describe("building a link that changes one param", () => {
  it("keeps the season when the tab changes", () => {
    // The two travel together: switching tab and coming back to a page that
    // forgot which season you were reading is a small betrayal that makes the
    // control feel broken.
    const href = showHref({ tab: "episodes", season: "3" }, { tab: "watch" });

    expect(href).toContain("season=3");
    expect(href).toContain("tab=watch");
  });

  it("keeps unrelated params too", () => {
    const href = showHref(
      { tab: "watch", country: "FR", altCountries: "12" },
      { tab: "about" },
    );

    expect(href).toContain("country=FR");
    expect(href).toContain("altCountries=12");
  });

  it("drops a param set to undefined", () => {
    const href = showHref({ tab: "watch", season: "2" }, { season: undefined });

    expect(href).not.toContain("season");
    expect(href).toContain("tab=watch");
  });

  it("collapses a repeated param to its last value", () => {
    const href = showHref({ season: ["1", "2"] }, { tab: "about" });

    expect(href).toContain("season=2");
    expect(href).not.toContain("season=1");
  });

  it("drops params the app doesn't read", () => {
    // Every link on the page used to copy the URL wholesale, so anything a
    // visitor arrived with was reflected into all of them. A crafted link is
    // then params × links of render and payload, chosen by whoever wrote it.
    const href = showHref(
      { tab: "watch", season: "2", utm_source: "x", "<script>": "y" },
      { tab: "about" },
    );

    expect(href).toContain("season=2");
    expect(href).toContain("tab=about");
    expect(href).not.toContain("utm_source");
    expect(href).not.toContain("script");
  });

  it("emits carried params in a stable order", () => {
    // Same state, same href, however the visitor arrived at it.
    const fromOne = showHref({ season: "2", country: "FR" }, { tab: "about" });
    const fromOther = showHref({ country: "FR", season: "2" }, { tab: "about" });

    expect(fromOne).toBe(fromOther);
  });
});
