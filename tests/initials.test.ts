import { describe, expect, it } from "vitest";

import { initials } from "@/lib/initials";

describe("initials", () => {
  it("takes one letter from a one-word nickname", () => {
    expect(initials("Theo")).toBe("T");
  });

  it("takes the first and last words' letters from a longer one", () => {
    expect(initials("theo brossollet")).toBe("TB");
    expect(initials("Anne Marie Smith")).toBe("AS");
  });

  it("skips what isn't a letter or digit rather than drawing it", () => {
    expect(initials("  @theo  (b)  ")).toBe("TB");
    expect(initials("élodie")).toBe("É");
  });

  it("falls back to a question mark when there is nothing to draw", () => {
    expect(initials(null)).toBe("?");
    expect(initials("")).toBe("?");
    expect(initials("🙂")).toBe("?");
  });
});
