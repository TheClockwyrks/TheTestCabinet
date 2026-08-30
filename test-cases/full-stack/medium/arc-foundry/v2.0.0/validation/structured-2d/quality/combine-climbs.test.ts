// Arc Foundry — `quality.combine-climbs`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `quality/combine-climbs.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Two base structures of the same type at the same quality
// fold into a single structure of that type one tier up: two Scrap Capacitors
// become one Tuned Capacitor, and the yard holds one fewer base structure and
// one more blocker.
//
// HOW IT IS DECIDED. Stand a matching pair, combine from one of them, and read
// the result and the consumed footprints back. The evidence it hands back is
// `fold` (image): the tier the fold produced.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("quality.combine-climbs", () => {
  it("Two matching rolls fold into one a tier higher", () => {
    fail(
      "a validator deciding this point",
      "the suite for `quality.combine-climbs` has not been written yet",
    );
  });
});
