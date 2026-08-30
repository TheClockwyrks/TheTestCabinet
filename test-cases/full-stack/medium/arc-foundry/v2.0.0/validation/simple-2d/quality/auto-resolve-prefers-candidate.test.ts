// Arc Foundry — `quality.auto-resolve-prefers-candidate`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `quality/auto-resolve-prefers-candidate.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With a candidate and a standing component both able to
// satisfy the same fold and no explicit combine set, the combine consumes the
// candidate, leaving the standing component in place.
//
// HOW IT IS DECIDED. Stand a component and roll a matching candidate, combine
// with an empty set, and read which footprint survived. The evidence it hands
// back is `resolve` (image): the candidate the fold consumed.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("quality.auto-resolve-prefers-candidate", () => {
  it("With no explicit set the game consumes a candidate first", () => {
    fail(
      "a validator deciding this point",
      "the suite for `quality.auto-resolve-prefers-candidate` has not been written yet",
    );
  });
});
