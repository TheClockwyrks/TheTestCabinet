// Arc Foundry — `press.reroll-blocker`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/reroll-blocker.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Dropping a rock onto the footprint of an existing blocker
// is the one placement that lands on tiles that are not Open: it spends a
// stamp, removes the blocker, and lands a fresh candidate on those four tiles.
//
// HOW IT IS DECIDED. Stand a blocker, arm the exact next roll, drop onto its
// footprint, and read the structure back. The evidence it hands back is
// `reroll` (image): the candidate that replaced the blocker.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.reroll-blocker", () => {
  it("A rock dropped onto a blocker rerolls it", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.reroll-blocker` has not been written yet",
    );
  });
});
