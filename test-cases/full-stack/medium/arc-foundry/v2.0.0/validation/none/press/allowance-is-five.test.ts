// Arc Foundry — `press.allowance-is-five`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/allowance-is-five.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A build phase opens with stampsLeft at STAMPS_PER_LEVEL
// (5), five drops are accepted, and the sixth is refused with nothing placed.
//
// HOW IT IS DECIDED. Take six drops in one build phase and read the structure
// count and stampsLeft after each. The evidence it hands back is `spent`
// (image): the yard after the allowance is spent.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.allowance-is-five", () => {
  it("A build phase grants five stamps", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.allowance-is-five` has not been written yet",
    );
  });
});
