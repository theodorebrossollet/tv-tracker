import { describe, expect, it } from "vitest";

import { pickCountry } from "@/lib/pick-country";

const available = [{ code: "FR" }, { code: "GB" }, { code: "US" }];

describe("choosing which country's availability to show", () => {
  it("prefers the country asked for in the URL", () => {
    expect(pickCountry(available, "GB", "FR")?.code).toBe("GB");
  });

  it("falls back to the settings country when the URL says nothing", () => {
    expect(pickCountry(available, undefined, "US")?.code).toBe("US");
  });

  it("falls back to the first available country when neither applies", () => {
    expect(pickCountry(available, undefined, null)?.code).toBe("FR");
  });

  it("ignores a URL country this show isn't available in", () => {
    // The param is hand-editable, and codes also go stale when TMDB drops a
    // country. Trusting it would render an empty panel rather than a fallback.
    expect(pickCountry(available, "ZZ", "US")?.code).toBe("US");
  });

  it("ignores a settings country this show isn't available in", () => {
    // The common real case: your country is set, but this particular show
    // isn't licensed there. The page says so separately and shows another.
    expect(pickCountry(available, undefined, "ZZ")?.code).toBe("FR");
  });

  it("takes the last value when a param is repeated", () => {
    // `?country=FR&country=GB` arrives as an array.
    expect(pickCountry(available, ["FR", "GB"], null)?.code).toBe("GB");
  });

  it("returns nothing when the show is available nowhere", () => {
    // The caller renders no panel at all rather than an empty one.
    expect(pickCountry([], "FR", "FR")).toBeUndefined();
  });
});
