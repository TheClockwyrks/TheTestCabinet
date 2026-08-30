// Arc Foundry — `campaign.wave-numbering`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/wave-numbering.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The first harvest launches wave 1, and clearing a wave
// raises the wave counter by one and returns the phase to build, so a run
// walks waves 1 through N in order.
//
// HOW IT IS DECIDED. Play three waves through and read the wave number and the
// phase at each transition. The evidence it hands back is `levels` (replay):
// the run stepping through its levels.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.wave-numbering", () => {
  it("Each cleared wave opens the next build phase", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.wave-numbering` has not been written yet",
    );
  });
});
