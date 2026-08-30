// Arc Foundry — `difficulty.difficulty-carried-into-run`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `difficulty/difficulty-carried-into-run.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Choosing a difficulty at the menu begins the run at that
// difficulty: the snapshot reports it, totalWaves matches it, and the Load
// scales by its constants.
//
// HOW IT IS DECIDED. Choose each difficulty from the menu in turn and read the
// run that opened. The evidence it hands back is `chosen` (image): the run
// opened at the chosen difficulty.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("difficulty.difficulty-carried-into-run", () => {
  it("The chosen difficulty is the one the run plays at", () => {
    fail(
      "a validator deciding this point",
      "the suite for `difficulty.difficulty-carried-into-run` has not been written yet",
    );
  });
});
