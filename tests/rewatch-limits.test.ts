import { expect, it } from "vitest";

import { MAX_PAST_RUNS, MAX_PAST_WATCHES } from "@/lib/rewatch";

it("caps past runs and past movie watches at 20", () => {
  expect(MAX_PAST_RUNS).toBe(20);
  expect(MAX_PAST_WATCHES).toBe(20);
});
