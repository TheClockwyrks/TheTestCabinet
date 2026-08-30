// Arc Foundry — `campaign.finale-takes-status`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/finale-takes-status.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The Overload Dynamo carries a slow and a burn like any
// other unit: a Choke's hit lowers its speed by the stated amount for the
// stated duration, and a Rectifier's burn tallies into the Maze Rating while
// it runs.
//
// HOW IT IS DECIDED. Hit the Overload Dynamo with a Choke and a Rectifier and
// read its speed, its slow and burn fields, and the Maze Rating. The evidence
// it hands back is `status` (replay): the Overload Dynamo slowed and burning.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.finale-takes-status", () => {
  it("The Overload Dynamo takes slow and burn", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.finale-takes-status` has not been written yet",
    );
  });
});
