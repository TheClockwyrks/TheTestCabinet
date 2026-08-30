// Arc Foundry — `refinement.refinement-midwave`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `refinement/refinement-midwave.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Refining the press resolves during a live wave exactly as
// it does in a build phase: the level rises, the Charge is spent, and the wave
// carries on.
//
// HOW IT IS DECIDED. Start a wave, refine the press, and read the level, the
// Charge and the phase back. The evidence it hands back is `midwave` (replay):
// the press refined mid-wave.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("refinement.refinement-midwave", () => {
  it("Refining is available during a live wave", () => {
    fail(
      "a validator deciding this point",
      "the suite for `refinement.refinement-midwave` has not been written yet",
    );
  });
});
