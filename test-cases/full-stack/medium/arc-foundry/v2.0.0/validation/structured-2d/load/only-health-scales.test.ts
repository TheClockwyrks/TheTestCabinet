// Arc Foundry — `load.only-health-scales`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/only-health-scales.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A unit's speed, bounty and leak value are the same at wave
// 1 and at wave 40: the roster's figures are constant for the whole run and
// only health grows.
//
// HOW IT IS DECIDED. Release each type at wave 1 and at a deep wave and
// compare its speed, bounty and leak. The evidence it hands back is `constant`
// (image): the roster's constant figures at depth.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.only-health-scales", () => {
  it("Only health scales across waves", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.only-health-scales` has not been written yet",
    );
  });
});
