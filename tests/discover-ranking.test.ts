import { describe, expect, it } from "vitest";
import type { TmdbRecommendation } from "@/lib/tmdb";
import {
  MAX_SEEDS,
  MIN_SEED_RATING,
  MIN_SEEDS,
  MIN_VOTES,
  rankCandidates,
  type Seed,
} from "@/lib/discover";

function cand(
  id: string,
  over: Partial<TmdbRecommendation> = {},
): TmdbRecommendation {
  return {
    kind: "show",
    id,
    name: `Title ${id}`,
    posterPath: null,
    overview: null,
    year: null,
    voteAverage: 7,
    voteCount: 1000,
    ...over,
  };
}

function seed(id: string, rating: number, kind: Seed["kind"] = "show"): Seed {
  return { kind, id, title: `Seed ${id}`, rating };
}

const ids = (r: ReturnType<typeof rankCandidates>) =>
  r.map((s) => `${s.candidate.kind}:${s.candidate.id}`);
const none = () => false;

describe("constants", () => {
  it("match the spec", () => {
    expect([MIN_SEED_RATING, MIN_SEEDS, MAX_SEEDS, MIN_VOTES]).toEqual([
      8, 3, 10, 100,
    ]);
  });
});

describe("rankCandidates ordering", () => {
  const cases: Array<{
    name: string;
    lists: Array<{ seed: Seed; candidates: TmdbRecommendation[] }>;
    expected: string[];
  }> = [
    {
      name: "two seeds outrank one seed",
      lists: [
        { seed: seed("a", 10), candidates: [cand("1", { voteAverage: 9 })] },
        { seed: seed("b", 8), candidates: [cand("2"), cand("1")] },
      ],
      expected: ["show:1", "show:2"],
    },
    {
      name: "equal counts: higher summed seed rating wins",
      lists: [
        { seed: seed("a", 10), candidates: [cand("1")] },
        { seed: seed("b", 8), candidates: [cand("2")] },
      ],
      expected: ["show:1", "show:2"],
    },
    {
      name: "then higher voteAverage",
      lists: [
        {
          seed: seed("a", 9),
          candidates: [
            cand("1", { voteAverage: 6 }),
            cand("2", { voteAverage: 8 }),
          ],
        },
      ],
      expected: ["show:2", "show:1"],
    },
    {
      name: "final tiebreak by kind then id",
      lists: [
        {
          seed: seed("a", 9),
          candidates: [
            cand("9", { kind: "show" }),
            cand("5", { kind: "show" }),
            cand("7", { kind: "movie" }),
          ],
        },
      ],
      expected: ["movie:7", "show:5", "show:9"],
    },
    {
      name: "same id under different kinds stays two entries",
      lists: [
        {
          seed: seed("a", 9),
          candidates: [
            cand("5", { kind: "movie" }),
            cand("5", { kind: "show" }),
          ],
        },
      ],
      expected: ["movie:5", "show:5"],
    },
    {
      name: "duplicates within one seed's list count once",
      lists: [
        { seed: seed("a", 8), candidates: [cand("1"), cand("1"), cand("1")] },
        { seed: seed("b", 8), candidates: [cand("2"), cand("1")] },
        { seed: seed("c", 8), candidates: [cand("2")] },
      ],
      expected: ["show:1", "show:2"],
    },
    { name: "empty input", lists: [], expected: [] },
  ];

  it.each(cases)("$name", ({ lists, expected }) => {
    expect(ids(rankCandidates(lists, none))).toEqual(expected);
  });

  it("is independent of input order", () => {
    const lists = [
      { seed: seed("a", 9), candidates: [cand("1"), cand("2"), cand("3")] },
      { seed: seed("b", 9), candidates: [cand("3"), cand("2")] },
      { seed: seed("c", 8), candidates: [cand("2")] },
    ];
    const forward = ids(rankCandidates(lists, none));
    const backward = ids(
      rankCandidates(
        [...lists].reverse().map((l) => ({
          ...l,
          candidates: [...l.candidates].reverse(),
        })),
        none,
      ),
    );
    expect(forward).toEqual(["show:2", "show:3", "show:1"]);
    expect(backward).toEqual(forward);
  });
});

describe("rankCandidates filtering", () => {
  it("drops candidates under the vote floor but keeps the floor itself", () => {
    const r = rankCandidates(
      [
        {
          seed: seed("a", 9),
          candidates: [
            cand("1", { voteCount: MIN_VOTES - 1 }),
            cand("2", { voteCount: MIN_VOTES }),
          ],
        },
      ],
      none,
    );
    expect(ids(r)).toEqual(["show:2"]);
  });

  it("drops candidates the exclude predicate rejects", () => {
    const r = rankCandidates(
      [{ seed: seed("a", 9), candidates: [cand("1"), cand("2")] }],
      (c) => c.id === "1",
    );
    expect(ids(r)).toEqual(["show:2"]);
  });
});

describe("rankCandidates because fields", () => {
  it("come from the highest-rated seed that produced the candidate", () => {
    const r = rankCandidates(
      [
        { seed: seed("a", 8), candidates: [cand("1")] },
        { seed: seed("b", 10), candidates: [cand("1")] },
        { seed: seed("c", 9), candidates: [cand("1")] },
      ],
      none,
    );
    expect(r).toHaveLength(1);
    expect(r[0].becauseTitle).toBe("Seed b");
    expect(r[0].becauseRating).toBe(10);
  });

  it("break equal seed ratings deterministically", () => {
    const a = { seed: seed("a", 9), candidates: [cand("1")] };
    const b = { seed: seed("b", 9), candidates: [cand("1")] };
    expect(rankCandidates([a, b], none)[0].becauseTitle).toBe("Seed a");
    expect(rankCandidates([b, a], none)[0].becauseTitle).toBe("Seed a");
  });
});
