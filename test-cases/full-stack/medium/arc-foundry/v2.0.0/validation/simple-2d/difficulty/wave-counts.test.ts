// Arc Foundry — `difficulty.wave-counts`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `difficulty/wave-counts.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A run reports totalWaves 40 on Easy, 50 on Medium and 60 on
// Hard, and its final wave is that number.
//
// HOW IT IS DECIDED. Begin a run at each difficulty and read totalWaves back.
// The evidence it hands back is `counts` (image): the wave count each
// difficulty runs.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("difficulty.wave-counts", () => {
  it("Each difficulty runs its stated number of waves", () => {
    fail(
      "a validator deciding this point",
      "the suite for `difficulty.wave-counts` has not been written yet",
    );
  });
});
