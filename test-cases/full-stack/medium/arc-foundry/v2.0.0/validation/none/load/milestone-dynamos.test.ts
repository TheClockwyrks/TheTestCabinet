// Arc Foundry — `load.milestone-dynamos`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/milestone-dynamos.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Exactly one Dynamo arrives on wave round(N / 2) and exactly
// one on wave N, and no other wave of the run carries one.
//
// HOW IT IS DECIDED. Play a run's waves through and count the Dynamos each
// wave released. The evidence it hands back is `milestone` (replay): the
// milestone Dynamo arriving.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.milestone-dynamos", () => {
  it("Wave round(N / 2) and wave N each carry one Dynamo", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.milestone-dynamos` has not been written yet",
    );
  });
});
