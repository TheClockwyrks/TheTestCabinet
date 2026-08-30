// Arc Foundry — `sprites.component-head-sprites`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/component-head-sprites.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/components/<type>/head-<tier>.png exists as a 40 by
// 40 PNG for all forty combinations of the eight base types and the five
// quality tiers, the Regulator's five included.
//
// HOW IT IS DECIDED. Read the forty files and decode each one's dimensions.
// The evidence it hands back is `heads` (image): the heads across the quality
// ladder.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.component-head-sprites", () => {
  it("Every component head is produced at every tier", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.component-head-sprites` has not been written yet",
    );
  });
});
