// Arc Foundry — `press.continuous-placement`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/continuous-placement.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. While stamps remain, a drop leaves a fresh rock armed on
// the cursor, so five rocks are placed back to back without arming the press
// again; the hand is empty once the allowance is spent.
//
// HOW IT IS DECIDED. Drop a rock and read the held state back, then repeat
// until the allowance is spent. The evidence it hands back is `held` (image):
// the next rock armed after a drop.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.continuous-placement", () => {
  it("A drop arms another rock immediately", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.continuous-placement` has not been written yet",
    );
  });
});
