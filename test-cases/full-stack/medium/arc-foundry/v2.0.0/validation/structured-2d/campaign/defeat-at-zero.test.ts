// Arc Foundry — `campaign.defeat-at-zero`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/defeat-at-zero.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Grid Integrity driven to 0 by a leak ends the run in defeat
// immediately, on the overload screen, even mid-wave with units still on the
// yard.
//
// HOW IT IS DECIDED. Set Grid Integrity to 1 mid-wave, walk a Mote into the
// collector, and read the screen. The evidence it hands back is `overload`
// (replay): the overload at zero Grid Integrity.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.defeat-at-zero", () => {
  it("Grid Integrity reaching zero ends the run", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.defeat-at-zero` has not been written yet",
    );
  });
});
