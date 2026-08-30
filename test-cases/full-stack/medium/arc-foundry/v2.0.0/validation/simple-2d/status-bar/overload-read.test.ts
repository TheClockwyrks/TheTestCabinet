// Arc Foundry — `status-bar.overload-read`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `status-bar/overload-read.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. During the finale the bar draws OVERLOAD, and the Maze
// Rating it draws beside it grows as the Overload Dynamo takes damage.
//
// HOW IT IS DECIDED. Enter the finale, read the bar's text draws, deal damage,
// and read them again. The evidence it hands back is `overload` (replay): the
// bar reading OVERLOAD with the rating accruing.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("status-bar.overload-read", () => {
  it("An OVERLOAD read shows during the finale", () => {
    fail(
      "a validator deciding this point",
      "the suite for `status-bar.overload-read` has not been written yet",
    );
  });
});
