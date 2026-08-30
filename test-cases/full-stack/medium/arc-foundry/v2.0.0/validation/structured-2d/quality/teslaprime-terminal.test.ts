// Arc Foundry — `quality.teslaprime-terminal`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `quality/teslaprime-terminal.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Two Tesla-Prime structures of one type offer no quality-
// combine, and a combine committed on one of them changes nothing, because
// there is no tier above the fifth.
//
// HOW IT IS DECIDED. Stand a Tesla-Prime pair, read the offered actions, and
// attempt the combine. The evidence it hands back is `terminal` (image): the
// Tesla-Prime pair at the top of the ladder.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("quality.teslaprime-terminal", () => {
  it("Tesla-Prime is the top rung", () => {
    fail(
      "a validator deciding this point",
      "the suite for `quality.teslaprime-terminal` has not been written yet",
    );
  });
});
