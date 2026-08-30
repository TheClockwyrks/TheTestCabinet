// Arc Foundry — `campaign.finale-leak-is-free`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/finale-leak-is-free.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The Overload Dynamo grounding out at the collector costs no
// Grid Integrity, and the game advances to the victory screen on that frame.
//
// HOW IT IS DECIDED. Walk the Overload Dynamo to the collector and read Grid
// Integrity and the screen as it grounds out. The evidence it hands back is
// `ground` (replay): the Overload Dynamo grounding out.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.finale-leak-is-free", () => {
  it("The Overload Dynamo's leak costs nothing", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.finale-leak-is-free` has not been written yet",
    );
  });
});
