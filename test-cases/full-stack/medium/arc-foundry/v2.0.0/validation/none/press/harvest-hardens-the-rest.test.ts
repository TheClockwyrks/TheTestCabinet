// Arc Foundry — `press.harvest-hardens-the-rest`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/harvest-hardens-the-rest.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Committing the harvest turns every other candidate on the
// yard into a blocker for the rest of the run: each reports kind blocker with
// a null type, a null quality and zero damage and range, and none of them can
// be harvested later.
//
// HOW IT IS DECIDED. Drop five rocks, keep one, and read the kind of the other
// four. The evidence it hands back is `settled` (image): the four blockers the
// harvest left.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.harvest-hardens-the-rest", () => {
  it("Every remaining candidate hardens into a blocker", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.harvest-hardens-the-rest` has not been written yet",
    );
  });
});
