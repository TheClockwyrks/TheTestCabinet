// Arc Foundry — `press.spends-one-stamp`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/spends-one-stamp.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A successful drop lowers stampsLeft by exactly one, and a
// refused drop leaves it where it was.
//
// HOW IT IS DECIDED. Read stampsLeft either side of an accepted drop and a
// refused one. The evidence it hands back is `stamps` (image): the stamp
// allowance across a placement.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.spends-one-stamp", () => {
  it("A landed rock spends exactly one stamp", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.spends-one-stamp` has not been written yet",
    );
  });
});
