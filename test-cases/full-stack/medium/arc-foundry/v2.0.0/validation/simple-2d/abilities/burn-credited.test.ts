// Arc Foundry — `abilities.burn-credited`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/burn-credited.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The health a burn removes counts toward the damageDealt
// tally of the structure whose shot applied it, and a kill by a burn tick
// counts toward that structure's kills.
//
// HOW IT IS DECIDED. Let one Rectifier burn a unit to death and read its two
// tallies. The evidence it hands back is `credit` (replay): the Rectifier
// credited with its burn.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.burn-credited", () => {
  it("Burn damage is credited to the structure that applied it", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.burn-credited` has not been written yet",
    );
  });
});
