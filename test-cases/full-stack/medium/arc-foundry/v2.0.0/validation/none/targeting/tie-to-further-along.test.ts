// Arc Foundry — `targeting.tie-to-further-along`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `targeting/tie-to-further-along.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Two in-range units that tie on the priority's own measure —
// the same distance under nearest, the same health under strongest — resolve
// toward the one further along the chain, so the choice is deterministic and
// repeats across two identical runs.
//
// HOW IT IS DECIDED. Park two units tied on the measure at different
// checkpoints and fire once under each tying priority. The evidence it hands
// back is `tie` (replay): the tie resolved toward the further unit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("targeting.tie-to-further-along", () => {
  it("A tie resolves toward the unit further along", () => {
    fail(
      "a validator deciding this point",
      "the suite for `targeting.tie-to-further-along` has not been written yet",
    );
  });
});
