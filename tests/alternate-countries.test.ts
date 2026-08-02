import { describe, expect, it } from "vitest";

import {
  coveredAtHome,
  findAlternateCountries,
  parseProviderIds,
} from "@/lib/alternate-countries";

const netflix = { id: 8 };
const appleTv = { id: 350 };
const someRentalOnly = { id: 999 };

const countries = [
  { code: "FR", flatrate: [], free: [], rent: [], buy: [someRentalOnly] },
  { code: "GB", flatrate: [netflix], free: [], rent: [], buy: [] },
  { code: "DE", flatrate: [], free: [appleTv], rent: [], buy: [] },
  { code: "US", flatrate: [], free: [], rent: [someRentalOnly], buy: [] },
];

describe("finding countries where your own services already have a show", () => {
  it("matches a provider on the flatrate (subscription) tier", () => {
    expect(findAlternateCountries(countries, [8], "FR")).toEqual([
      { code: "GB", providers: [netflix] },
    ]);
  });

  it("matches a provider on the free tier", () => {
    expect(findAlternateCountries(countries, [350], "FR")).toEqual([
      { code: "DE", providers: [appleTv] },
    ]);
  });

  it("ignores rent/buy — those cost money regardless of country", () => {
    // Country FR only has the show on `buy`, via a provider the user owns id
    // 999 for; US only has it on `rent`. Neither should count as a match.
    expect(findAlternateCountries(countries, [999], "GB")).toEqual([]);
  });

  it("excludes the home country from the results", () => {
    expect(findAlternateCountries(countries, [8], "GB")).toEqual([]);
  });

  it("returns nothing when no providers are picked", () => {
    expect(findAlternateCountries(countries, [], "FR")).toEqual([]);
  });

  it("sorts results by country code", () => {
    const result = findAlternateCountries(countries, [8, 350], "FR");
    expect(result.map((country) => country.code)).toEqual(["DE", "GB"]);
  });

  // Without a home country there is nothing to be "elsewhere" from, and the
  // section's copy claims the show isn't available where the user is — which
  // would be a claim about a place the app doesn't know.
  it("returns nothing when no home country is set", () => {
    expect(findAlternateCountries(countries, [8, 350], undefined)).toEqual([]);
  });
});

describe("deciding whether the home country already has it covered", () => {
  it("is true when the home country has one of the owned providers", () => {
    expect(coveredAtHome(countries, [8], "GB")).toBe(true);
  });

  it("is false when the home country doesn't have any of them", () => {
    expect(coveredAtHome(countries, [8], "FR")).toBe(false);
  });

  it("is false when there's no home country set", () => {
    expect(coveredAtHome(countries, [8], undefined)).toBe(false);
  });

  it("is false when no providers are picked", () => {
    expect(coveredAtHome(countries, [], "GB")).toBe(false);
  });

  it("ignores a rent/buy-only match at home", () => {
    expect(coveredAtHome(countries, [999], "FR")).toBe(false);
  });
});

describe("parsing the stored provider-id list", () => {
  it("splits a comma-separated string into numbers", () => {
    expect(parseProviderIds("8,350")).toEqual([8, 350]);
  });

  it("returns an empty list for null", () => {
    expect(parseProviderIds(null)).toEqual([]);
  });

  it("drops anything that isn't a positive integer", () => {
    expect(parseProviderIds("8,-1,0,abc,350")).toEqual([8, 350]);
  });
});
