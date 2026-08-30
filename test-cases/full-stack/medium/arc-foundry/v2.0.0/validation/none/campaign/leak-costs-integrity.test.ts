// Arc Foundry — `campaign.leak-costs-integrity`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/leak-costs-integrity.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A unit that grounds out at the collector costs the player
// its leak value in Grid Integrity and is removed: a Mote costs 1, a Slug 2
// and a Dynamo 5.
//
// HOW IT IS DECIDED. Walk one of each type to the collector and read Grid
// Integrity as each grounds out. The evidence it hands back is `leak`
// (replay): a unit leaking Grid Integrity.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.leak-costs-integrity", () => {
  it("A leak costs Grid Integrity", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.leak-costs-integrity` has not been written yet",
    );
  });
});
