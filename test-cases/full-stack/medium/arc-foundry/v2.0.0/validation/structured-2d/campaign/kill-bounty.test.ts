// Arc Foundry — `campaign.kill-bounty`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/kill-bounty.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Destroying a unit pays exactly its bounty the instant it is
// removed: a Mote pays 1, a Slug 3 and a Dynamo 40.
//
// HOW IT IS DECIDED. Kill one of each type and read Charge on the frame each
// is removed. The evidence it hands back is `kill` (replay): a kill paying its
// bounty.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.kill-bounty", () => {
  it("A kill pays its bounty in Charge", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.kill-bounty` has not been written yet",
    );
  });
});
