// Arc Foundry — `instrumentation.seeded-rolls-repeat`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `instrumentation/seeded-rolls-repeat.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. reset({seed: 42}) followed by the same sequence of
// placements rolls the same types and qualities in the same order both times,
// so every random draw runs off the generator reset seeds.
//
// HOW IT IS DECIDED. Reset to a fixed seed twice and compare the rolled type
// and quality of a counted run of placements. The evidence it hands back is
// `rolls` (image): the yard of rolls the seeded press produced.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("instrumentation.seeded-rolls-repeat", () => {
  it("The same seed reaches the same rolls", () => {
    fail(
      "a validator deciding this point",
      "the suite for `instrumentation.seeded-rolls-repeat` has not been written yet",
    );
  });
});
