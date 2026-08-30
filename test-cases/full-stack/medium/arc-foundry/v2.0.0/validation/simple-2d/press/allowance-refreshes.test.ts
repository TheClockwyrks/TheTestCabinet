// Arc Foundry — `press.allowance-refreshes`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/allowance-refreshes.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. After a wave has been launched with stamps still unspent
// and then cleared, the next build phase opens with stampsLeft back at 5, so
// unused stamps do not carry over and none are lost.
//
// HOW IT IS DECIDED. Harvest with stamps remaining, clear the wave, and read
// stampsLeft at the next build phase. The evidence it hands back is `refresh`
// (image): the refreshed allowance at the next build phase.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.allowance-refreshes", () => {
  it("The allowance refreshes to five each build phase", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.allowance-refreshes` has not been written yet",
    );
  });
});
