import { describe, expect, it } from "vitest";

import { typeFrom } from "@/lib/library-type";

describe("typeFrom", () => {
  it("is movies only for exactly `movies`", () => {
    expect(typeFrom({ type: "movies" })).toBe("movies");
  });

  it.each([
    [{}],
    [{ type: undefined }],
    [{ type: "shows" }],
    [{ type: "MOVIES" }],
    [{ type: "movies " }],
    [{ type: "" }],
    [{ type: "junk" }],
    [{ type: ["movies", "shows"] }],
  ])("is shows for %j", (params) => {
    expect(typeFrom(params)).toBe("shows");
  });

  it("reads the last of a repeated value", () => {
    expect(typeFrom({ type: ["shows", "movies"] })).toBe("movies");
  });
});
