// Arc Foundry — `firing.cadence`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `firing/cadence.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Over a counted interval with a target always in range, the
// number of projectiles a structure launched matches its reported fire rate in
// shots per second, within one shot.
//
// HOW IT IS DECIDED. Park a frozen invincible target in range and count the
// projectiles launched over ten seconds. The evidence it hands back is
// `cadence` (replay): the shots counted over the interval.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("firing.cadence", () => {
  it("A structure fires at its stated rate", () => {
    fail(
      "a validator deciding this point",
      "the suite for `firing.cadence` has not been written yet",
    );
  });
});
