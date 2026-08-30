// Arc Foundry — `status-bar.paused-read`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `status-bar/paused-read.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. While the in-place pause is engaged the bar draws PAUSED,
// and it does not draw it while the game is running.
//
// HOW IT IS DECIDED. Read the bar's text draws with the in-place pause engaged
// and released. The evidence it hands back is `paused` (image): the bar
// reading PAUSED.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("status-bar.paused-read", () => {
  it("A PAUSED read shows while paused in place", () => {
    fail(
      "a validator deciding this point",
      "the suite for `status-bar.paused-read` has not been written yet",
    );
  });
});
