import { describe, expect, it } from "vitest";

import { isViewMode, parseViewMode } from "@/lib/view-mode";

describe("view mode", () => {
  it("accepts exactly the two modes", () => {
    expect(isViewMode("rows")).toBe(true);
    expect(isViewMode("posters")).toBe(true);
    for (const junk of ["", "Rows", "grid", "posters ", null, undefined, 1, {}]) {
      expect(isViewMode(junk)).toBe(false);
    }
  });

  it("falls back to rows for anything else", () => {
    expect(parseViewMode("posters")).toBe("posters");
    expect(parseViewMode("rows")).toBe("rows");
    expect(parseViewMode(undefined)).toBe("rows");
    expect(parseViewMode("banana")).toBe("rows");
    expect(parseViewMode(["posters"])).toBe("rows");
  });
});
