// Arc Foundry — `instrumentation.snapshot-resting-values`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `instrumentation/snapshot-resting-values.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The shape is fixed whatever the screen: on the title screen
// phase is null, wave is 0, mazeRating is 0, selected and nextRoll are null,
// combineSet, units, structures and projectiles are empty, and held reads {
// active: false, col: 0, row: 0, legal: false }. No field goes missing.
//
// HOW IT IS DECIDED. Reset to the title and read every field of the resting-
// values table in specs/instrumentation.md. The evidence it hands back is
// `title` (image): the title screen whose snapshot is read.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("instrumentation.snapshot-resting-values", () => {
  it("Fields the current screen does not use report their resting values", () => {
    fail(
      "a validator deciding this point",
      "the suite for `instrumentation.snapshot-resting-values` has not been written yet",
    );
  });
});
