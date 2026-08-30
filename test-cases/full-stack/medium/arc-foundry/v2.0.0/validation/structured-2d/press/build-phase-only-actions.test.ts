// Arc Foundry — `press.build-phase-only-actions`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/build-phase-only-actions.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. During a live wave a stamp, a keep, a downgrade and a
// dismantle each change nothing: no structure is placed or removed, no stamp
// is spent and no component is harvested.
//
// HOW IT IS DECIDED. Start a wave and attempt each of the four actions in
// turn, reading the yard back after each. The evidence it hands back is
// `refused` (replay): the yard unchanged across four refused build actions.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.build-phase-only-actions", () => {
  it("Stamping, keeping, downgrading and dismantling are build-phase actions", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.build-phase-only-actions` has not been written yet",
    );
  });
});
