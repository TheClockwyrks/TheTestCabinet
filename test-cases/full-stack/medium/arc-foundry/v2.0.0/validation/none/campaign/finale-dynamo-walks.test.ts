// Arc Foundry — `campaign.finale-dynamo-walks`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/finale-dynamo-walks.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The finale releases exactly one Overload Dynamo at the
// entry, which walks the ordered chain to the collector by the open route of
// least length at a speed of OVERLOAD_SPEED (55).
//
// HOW IT IS DECIDED. Enter the finale and sample the Overload Dynamo's
// position, waypointIndex and speed across its walk. The evidence it hands
// back is `walk` (replay): the Overload Dynamo walking the maze.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.finale-dynamo-walks", () => {
  it("The Overload Dynamo walks the chain at 55", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.finale-dynamo-walks` has not been written yet",
    );
  });
});
