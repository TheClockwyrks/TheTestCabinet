// Arc Foundry — `controls.key-speed`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-speed.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyF steps the multiplier through 1, 2, 4, 8 and
// back to 1, one step per press, and the multiplier persists until changed.
//
// HOW IT IS DECIDED. Press KeyF five times and read the reported speed after
// each. The evidence it hands back is `cycle` (image): the speed cycling
// through the four.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-speed", () => {
  it("KeyF cycles the speed multiplier", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-speed` has not been written yet",
    );
  });
});
