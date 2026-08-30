// Arc Foundry — `quality.combine-same-type-and-tier-only`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `quality/combine-same-type-and-tier-only.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A quality-combine is offered on a base structure that has a
// matching partner and on nothing else: a Capacitor beside a Coil at the same
// tier, and a Scrap Capacitor beside a Tuned one, each offer no fold and a
// combine on either changes nothing.
//
// HOW IT IS DECIDED. Stand each mismatched pair in turn, read the offered
// actions, and attempt the combine. The evidence it hands back is `refused`
// (image): the mismatched pair that offers no fold.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("quality.combine-same-type-and-tier-only", () => {
  it("A quality fold takes a same-type, same-tier pair alone", () => {
    fail(
      "a validator deciding this point",
      "the suite for `quality.combine-same-type-and-tier-only` has not been written yet",
    );
  });
});
