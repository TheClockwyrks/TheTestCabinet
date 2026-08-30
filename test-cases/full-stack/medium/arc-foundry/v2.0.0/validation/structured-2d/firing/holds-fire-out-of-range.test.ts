// Arc Foundry — `firing.holds-fire-out-of-range`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `firing/holds-fire-out-of-range.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A unit parked just outside the structure's radius draws no
// shot over five seconds: no projectile appears and the structure reports
// firing false.
//
// HOW IT IS DECIDED. Park a frozen unit one unit beyond the reported range and
// advance five seconds. The evidence it hands back is `hold` (replay): the
// structure holding fire.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("firing.holds-fire-out-of-range", () => {
  it("A structure holds fire with nothing in range", () => {
    fail(
      "a validator deciding this point",
      "the suite for `firing.holds-fire-out-of-range` has not been written yet",
    );
  });
});
